import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildOpenApiDocument } from './openapi.js';
import { isAdminAuthorized } from './auth.js';
import { LogBuffer } from './logs.js';
import {
  applyCors,
  notFound,
  parsePayload,
  Router,
  sendJson,
  sendManagementError,
  sendText,
  setCommonHeaders
} from './http.js';
import { RuntimeHandler } from './runtime.js';
import { DriverManager } from './driver-manager.js';
import { DatasourceService } from './services/datasource-service.js';
import { EndpointService } from './services/endpoint-service.js';
import { QueryService } from './services/query-service.js';
import { CrudService } from './services/crud-service.js';
import { hashText } from './utils.js';
import { AppError, ValidationError } from './errors.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

export function createApplication({
  config,
  store,
  secretBox,
  driverManager = new DriverManager({
    oracleThickMode: config.oracleThickMode,
    oracleClientLibDir: config.oracleClientLibDir
  })
}) {
  const logs = new LogBuffer(200);
  const datasourceService = new DatasourceService({ store, secretBox, driverManager });
  const endpointService = new EndpointService({ store });
  const queryService = new QueryService({ driverManager, endpointService });
  const crudService = new CrudService({ datasourceService, endpointService });
  const runtime = new RuntimeHandler({
    config,
    store,
    datasourceService,
    queryService,
    endpointService,
    logs
  });
  const router = createRouter();

  async function handler(req, res) {
    setCommonHeaders(res);
    let url;
    try {
      url = new URL(req.url || '/', 'http://node-magic.local');
    } catch {
      sendText(res, 400, 'Bad Request');
      return;
    }
    const pathname = normalizePathname(url.pathname);

    try {
      if (pathname === config.openapiPath || pathname.startsWith(`${config.openapiPath}/`)) {
        if (req.method === 'OPTIONS') applyCors(req, res, config);
        await runtime.handle(req, res, pathname, url);
        return;
      }

      if (pathname === `${config.managementPath}/health` && req.method === 'GET') {
        const drivers = await driverManager.driverStatus();
        sendJson(res, 200, {
          ok: true,
          service: 'node-magic-api',
          time: new Date().toISOString(),
          drivers
        });
        return;
      }

      if (pathname.startsWith(`${config.managementPath}/`)) {
        if (!isAdminAuthorized(req, config)) {
          sendJson(res, 401, {
            ok: false,
            error: {
              code: 'ADMIN_AUTH_REQUIRED',
              message: config.adminToken
                ? '需要有效的访问令牌'
                : '当前服务只允许本机访问管理接口，请配置 ADMIN_TOKEN'
            }
          });
          return;
        }
        if (req.method === 'OPTIONS') {
          res.statusCode = 204;
          res.end();
          return;
        }
        const match = router.match(req.method, pathname);
        if (!match) {
          notFound(res, '管理接口不存在');
          return;
        }
        await match.handler({ req, res, params: match.params, url });
        return;
      }

      if ((req.method === 'GET' || req.method === 'HEAD') && isUiPath(pathname)) {
        await serveFile(res, path.join(config.publicDir, 'index.html'), req.method);
        return;
      }

      if (req.method === 'GET' || req.method === 'HEAD') {
        const filePath = safePublicPath(config.publicDir, pathname);
        if (filePath) {
          const served = await serveFile(res, filePath, req.method);
          if (served) return;
        }
      }

      sendText(res, 404, 'Not Found');
    } catch (error) {
      if (!(error instanceof AppError)) console.error(error);
      if (pathname.startsWith(config.managementPath)) {
        sendManagementError(res, error);
      } else {
        sendJson(res, error.status || 500, {
          code: error.status || 500,
          message: error.message || '服务器内部错误',
          data: null
        });
      }
    }
  }

  function createRouter() {
    const instance = new Router();

    instance.get('/magic/api/bootstrap', async ({ res }) => {
      const snapshot = store.snapshot();
      const drivers = await driverManager.driverStatus();
      sendJson(res, 200, {
        ok: true,
        data: {
          datasources: datasourceService.list(),
          endpoints: snapshot.endpoints,
          logs: logs.list(),
          config: {
            openapiPath: config.openapiPath,
            adminTokenRequired: Boolean(config.adminToken),
            openapiTokenRequired: Boolean(config.openapiToken),
            drivers,
            version: config.version,
            serverTime: new Date().toISOString()
          }
        }
      });
    });

    instance.get('/magic/api/datasources', async ({ res }) => {
      sendJson(res, 200, { ok: true, data: datasourceService.list() });
    });

    instance.post('/magic/api/datasources', async ({ req, res }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const datasource = await datasourceService.create(body);
      sendJson(res, 201, { ok: true, data: datasource });
    });

    instance.post('/magic/api/datasources/test', async ({ req, res }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const result = await datasourceService.testDraft(body);
      sendJson(res, 200, { ok: true, data: result });
    });

    instance.get('/magic/api/datasources/:id', async ({ res, params }) => {
      sendJson(res, 200, { ok: true, data: datasourceService.get(params.id) });
    });

    instance.put('/magic/api/datasources/:id', async ({ req, res, params }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const datasource = await datasourceService.update(params.id, body);
      sendJson(res, 200, { ok: true, data: datasource });
    });

    instance.delete('/magic/api/datasources/:id', async ({ res, params }) => {
      await datasourceService.remove(params.id);
      sendJson(res, 200, { ok: true, data: { deleted: true } });
    });

    instance.post('/magic/api/datasources/:id/test', async ({ res, params }) => {
      const result = await datasourceService.testById(params.id);
      sendJson(res, 200, { ok: true, data: result });
    });

    instance.get('/magic/api/datasources/:id/tables', async ({ res, params }) => {
      const tables = await datasourceService.listTables(params.id);
      sendJson(res, 200, { ok: true, data: tables });
    });

    instance.get('/magic/api/datasources/:id/tables/:table/columns', async ({ res, params }) => {
      const table = await datasourceService.getTableInfo(params.id, params.table);
      sendJson(res, 200, { ok: true, data: table });
    });

    instance.post('/magic/api/datasources/:id/tables/:table/preview', async ({ req, res, params }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const preview = await crudService.preview(params.id, params.table, body);
      sendJson(res, 200, { ok: true, data: preview });
    });

    instance.post('/magic/api/datasources/:id/tables/:table/generate', async ({ req, res, params }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const generated = await crudService.generate(params.id, params.table, body);
      sendJson(res, 201, { ok: true, data: generated });
    });

    instance.get('/magic/api/endpoints', async ({ res }) => {
      sendJson(res, 200, { ok: true, data: endpointService.list() });
    });

    instance.post('/magic/api/endpoints', async ({ req, res }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const endpoint = await endpointService.create(body);
      sendJson(res, 201, { ok: true, data: endpoint });
    });

    instance.get('/magic/api/endpoints/:id', async ({ res, params }) => {
      sendJson(res, 200, { ok: true, data: endpointService.get(params.id) });
    });

    instance.put('/magic/api/endpoints/:id', async ({ req, res, params }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const endpoint = await endpointService.update(params.id, body);
      sendJson(res, 200, { ok: true, data: endpoint });
    });

    instance.delete('/magic/api/endpoints/:id', async ({ res, params }) => {
      await endpointService.remove(params.id);
      sendJson(res, 200, { ok: true, data: { deleted: true } });
    });

    instance.post('/magic/api/console/render', async ({ req, res }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const { endpoint, datasource, sources } = await prepareConsole({ body });
      const rendered = queryService.preview({ endpoint, datasource, sources });
      sendJson(res, 200, { ok: true, data: rendered });
    });

    instance.post('/magic/api/console/run', async ({ req, res }) => {
      const body = await parsePayload(req, { limit: config.maxBodyBytes });
      const { endpoint, datasource, sources } = await prepareConsole({ body });
      const result = await queryService.execute({ endpoint, datasource, sources });
      sendJson(res, 200, { ok: true, data: result });
    });

    instance.get('/magic/api/logs', async ({ res }) => {
      sendJson(res, 200, { ok: true, data: logs.list() });
    });

    instance.delete('/magic/api/logs', async ({ res }) => {
      logs.clear();
      sendJson(res, 200, { ok: true, data: { cleared: true } });
    });

    instance.get('/magic/api/openapi.json', async ({ res }) => {
      const snapshot = store.snapshot();
      const document = buildOpenApiDocument({
        endpoints: snapshot.endpoints,
        datasources: datasourceService.list(),
        config
      });
      sendJson(res, 200, document);
    });

    return instance;
  }

  async function prepareConsole({ body }) {
    const datasourceId = String(body.datasourceId || '');
    if (!datasourceId) throw new ValidationError('请先选择数据源');
    const datasource = await datasourceService.resolveById(datasourceId);
    const sql = String(body.sql || '').trim();
    if (!sql) throw new ValidationError('SQL 不能为空');
    const key = hashText(`${datasourceId}:${sql}:${JSON.stringify(body.params || [])}`, 20);
    const endpoint = {
      id: `preview_${key}`,
      name: '预览接口',
      method: 'POST',
      path: '/preview',
      datasourceId,
      sql,
      description: '',
      enabled: true,
      allowRawSql: Boolean(body.allowRawSql),
      params: normalizePreviewParams(body.params),
      pagination: {
        enabled: Boolean(body.pagination?.enabled ?? body.paginationEnabled),
        maxPageSize: 200
      },
      responseMode: 'raw',
      updatedAt: new Date().toISOString()
    };
    const values = body.values && typeof body.values === 'object' ? body.values : {};
    const headers = Object.fromEntries(
      Object.entries(values).map(([key, value]) => [key.toLowerCase(), value])
    );
    return {
      endpoint,
      datasource,
      sources: { query: values, body: values, path: values, headers }
    };
  }

  return {
    handler,
    services: { datasourceService, endpointService, queryService, crudService, driverManager, logs }
  };
}

function normalizePreviewParams(params) {
  if (!Array.isArray(params)) return [];
  return params
    .filter((param) => param && typeof param.name === 'string' && param.name.trim())
    .map((param) => ({
      name: param.name.trim(),
      in: ['query', 'body', 'path', 'header'].includes(param.in) ? param.in : 'body',
      type: ['string', 'number', 'boolean', 'date', 'json', 'array'].includes(param.type)
        ? param.type
        : 'string',
      required: Boolean(param.required),
      defaultValue:
        param.defaultValue === undefined || param.defaultValue === null || param.defaultValue === ''
          ? null
          : String(param.defaultValue),
      description: String(param.description || '')
    }));
}

function normalizePathname(pathname) {
  if (pathname.length > 1) return pathname.replace(/\/+$/, '') || '/';
  return pathname;
}

function isUiPath(pathname) {
  return pathname === '/' || pathname === '/magic' || pathname === '/magic/';
}

function safePublicPath(publicDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const resolved = path.resolve(publicDir, `.${decoded}`);
  if (resolved !== publicDir && !resolved.startsWith(`${publicDir}${path.sep}`)) return null;
  return resolved;
}

async function serveFile(res, filePath, method) {
  try {
    const content = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME_TYPES[extension] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    if (extension === '.html') {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'"
      );
    }
    if (method === 'HEAD') res.end();
    else res.end(content);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
