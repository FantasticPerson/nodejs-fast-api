import { AppError, ValidationError } from './errors.js';
import {
  applyCors,
  normalizeHeaders,
  parsePayload,
  parseQuery,
  requestIp,
  sendJson,
  setCommonHeaders
} from './http.js';
import { compilePath, matchCompiledPath } from './path.js';
import { safeTokenEqual } from './auth.js';
import { truncate } from './utils.js';

export class RuntimeHandler {
  constructor({ config, store, datasourceService, queryService, scriptService, endpointService, logs }) {
    this.config = config;
    this.store = store;
    this.datasourceService = datasourceService;
    this.queryService = queryService;
    this.scriptService = scriptService;
    this.endpointService = endpointService;
    this.logs = logs;
    this.routeCache = new Map();
  }

  async handle(req, res, pathname, url) {
    applyCors(req, res, this.config);
    setCommonHeaders(res);
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }
    if (!this.authorized(req)) {
      sendJson(res, 401, { code: 401, message: '缺少或无效的 x-api-token', data: null });
      return;
    }

    const relativePath = pathname.slice(this.config.openapiPath.length) || '/';
    const endpoint = this.findEndpoint(req.method, relativePath, this.store.getRuntimeEndpoints());
    const startedAt = Date.now();
    if (!endpoint) {
      sendJson(res, 404, { code: 404, message: '接口不存在', data: null });
      return;
    }

    let status = 200;
    let errorText = '';
    try {
      const sources = {
        query: parseQuery(url.searchParams),
        body: await parsePayload(req, { limit: this.config.maxBodyBytes, allowForm: true }),
        path: endpoint.matchParams,
        headers: normalizeHeaders(req.headers)
      };
      const datasource = await this.datasourceService.resolveById(endpoint.record.datasourceId);
      const payload =
        endpoint.record.engine === 'script'
          ? (
              await this.scriptService.execute({
                endpoint: endpoint.record,
                datasource,
                sources
              })
            ).value
          : await this.queryService.execute({
              endpoint: endpoint.record,
              datasource,
              sources
            });
      const responsePayload =
        endpoint.record.responseMode === 'raw'
          ? payload
          : { code: 0, message: 'ok', data: payload };
      sendJson(res, 200, responsePayload);
      this.endpointService.recordCall(endpoint.record.id).catch(() => {});
    } catch (error) {
      status = error instanceof AppError ? error.status : 500;
      const errorCode = error instanceof AppError ? error.code : 'INTERNAL_ERROR';
      const message =
        error instanceof ValidationError
          ? error.message
          : error instanceof AppError
            ? error.message
            : '服务器内部错误';
      errorText = message;
      const responsePayload =
        endpoint.record.responseMode === 'raw'
          ? { error: message, code: status, errorCode }
          : { code: status, message, data: null, errorCode };
      sendJson(res, status, responsePayload);
    } finally {
      this.logs.add({
        endpointId: endpoint.record.id,
        name: endpoint.record.name,
        method: endpoint.record.method,
        path: endpoint.record.path,
        status,
        durationMs: Date.now() - startedAt,
        sourceIp: requestIp(req),
        error: truncate(errorText, 300)
      });
    }
  }

  authorized(req) {
    if (!this.config.openapiToken) return true;
    const header = req.headers['x-api-token'];
    const authorization = req.headers.authorization || '';
    const bearer = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
    return safeTokenEqual(String(header || bearer || ''), this.config.openapiToken);
  }

  findEndpoint(method, pathname, endpoints) {
    const normalizedMethod = method === 'HEAD' ? 'GET' : method;
    const candidates = endpoints.filter(
      (endpoint) => endpoint.enabled && endpoint.method === normalizedMethod
    );
    for (const endpoint of candidates) {
      const compiled = this.getRoute(endpoint);
      const params = matchCompiledPath(compiled, pathname);
      if (params) return { record: endpoint, matchParams: params };
    }
    return null;
  }

  getRoute(endpoint) {
    const signature = `${endpoint.updatedAt}:${endpoint.path}`;
    const cached = this.routeCache.get(endpoint.id);
    if (cached?.signature === signature) return cached.compiled;
    const compiled = compilePath(endpoint.path);
    this.routeCache.set(endpoint.id, { signature, compiled });
    return compiled;
  }
}
