import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { AppError, ValidationError } from '../errors.js';
import { renderScriptSql } from '../sql/bindings.js';
import { buildContext } from '../services/query-service.js';
import { truncate } from '../utils.js';

const MAX_RESULT_BYTES = 2 * 1024 * 1024;
const HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export class ScriptService {
  constructor({
    driverManager,
    scriptLibraryService,
    pluginRegistry,
    scriptHttpAllowlist = [],
    scriptHttpMaxResponseBytes = 1024 * 1024,
    scriptWorkerMemoryMb = 128,
    scriptTimeoutMs = 30000
  }) {
    this.driverManager = driverManager;
    this.scriptLibraryService = scriptLibraryService;
    this.pluginRegistry = pluginRegistry;
    this.scriptHttpAllowlist = scriptHttpAllowlist;
    this.scriptHttpMaxResponseBytes = scriptHttpMaxResponseBytes;
    this.scriptWorkerMemoryMb = scriptWorkerMemoryMb;
    this.scriptTimeoutMs = scriptTimeoutMs;
  }

  async execute({ endpoint, datasource, sources }) {
    if (endpoint.engine !== 'script') throw new ValidationError('接口不是脚本类型');
    const built = buildContext(endpoint, sources);
    const timeoutMs = Number(endpoint.timeoutMs || this.scriptTimeoutMs);
    const deadline = Date.now() + timeoutMs;
    await this.pluginRegistry.ensureLoaded();
    const libs = this.scriptLibraryService.enabledLibraries().map((library) => ({
      name: library.name,
      code: library.code
    }));
    const metadata = this.pluginRegistry.metadata();
    const workerData = {
      source: endpoint.scriptCode,
      endpoint: {
        id: endpoint.id,
        name: endpoint.name,
        allowHttp: Boolean(endpoint.allowHttp)
      },
      params: built.context,
      request: sanitizeRequest(sources),
      libs,
      plugins: metadata.plugins
    };
    const worker = new Worker(new URL('./worker.js', import.meta.url), {
      workerData,
      resourceLimits: { maxOldGenerationSizeMb: this.scriptWorkerMemoryMb }
    });
    const transactions = new Map();
    let settled = false;
    let timer = null;

    return await new Promise((resolve, reject) => {
      const finish = async (error, outcome) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        await cleanupTransactions(transactions);
        await worker.terminate().catch(() => {});
        if (error) reject(error);
        else resolve(outcome);
      };

      timer = setTimeout(() => {
        finish(
          new AppError(`脚本执行超时（${timeoutMs}ms）`, 504, 'SCRIPT_TIMEOUT'),
          null
        );
      }, timeoutMs);

      worker.on('message', (message) => {
        if (message.type === 'result') {
          try {
            const size = Buffer.byteLength(JSON.stringify(message.value ?? null));
            if (size > MAX_RESULT_BYTES) {
              finish(new AppError('脚本返回结果超过 2 MB 限制', 500, 'SCRIPT_RESULT_TOO_LARGE'), null);
              return;
            }
            finish(null, { value: message.value ?? null, logs: message.logs || [] });
          } catch {
            finish(new AppError('脚本返回结果无法序列化为 JSON', 500, 'SCRIPT_RESULT_INVALID'), null);
          }
          return;
        }
        if (message.type === 'error') {
          finish(new AppError(message.error || '脚本执行失败', 500, 'SCRIPT_EXECUTION_FAILED'), null);
          return;
        }
        if (!message.id) return;
        handleRpc(message, {
          service: this,
          endpoint,
          datasource,
          params: built.context,
          sources,
          deadline,
          transactions
        })
          .then((value) => worker.postMessage({ id: message.id, ok: true, value }))
          .catch((error) =>
            worker.postMessage({
              id: message.id,
              ok: false,
              error: truncate(error?.message || error, 500)
            })
          );
      });
      worker.on('error', (error) => {
        finish(new AppError(`脚本执行失败：${truncate(error?.message || error, 500)}`, 500, 'SCRIPT_EXECUTION_FAILED'), null);
      });
      worker.on('exit', (code) => {
        if (!settled) {
          finish(new AppError(`脚本工作线程异常退出（code ${code}）`, 500, 'SCRIPT_WORKER_EXITED'), null);
        }
      });
    });
  }

  async handleHttp({ endpoint, url, options, deadline }) {
    if (!endpoint.allowHttp) {
      throw new AppError('该接口未开启外部 HTTP 访问', 403, 'SCRIPT_HTTP_DISABLED');
    }
    const target = validateHttpTarget(url, this.scriptHttpAllowlist);
    const method = String(options?.method || 'GET').toUpperCase();
    if (!HTTP_METHODS.has(method)) throw new ValidationError('HTTP 方法不受支持');
    const headers = normalizeHttpHeaders(options?.headers);
    const controller = new AbortController();
    const remaining = remainingMs(deadline);
    const abortTimer = setTimeout(() => controller.abort(), remaining);
    try {
      let body = options?.body;
      if (body !== undefined && typeof body !== 'string') {
        body = JSON.stringify(body);
        if (!headers['content-type']) headers['content-type'] = 'application/json';
      }
      const response = await fetch(target, {
        method,
        headers,
        body,
        signal: controller.signal,
        redirect: 'manual'
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > this.scriptHttpMaxResponseBytes) {
        throw new AppError('外部 HTTP 响应超过大小限制', 502, 'SCRIPT_HTTP_RESPONSE_TOO_LARGE');
      }
      const text = bytes.toString('utf8');
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {}
      return {
        status: response.status,
        ok: response.ok,
        headers: Object.fromEntries(
          [...response.headers.entries()].filter(([name]) => name !== 'set-cookie')
        ),
        body: text,
        data
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(`外部 HTTP 请求失败：${truncate(error?.message || error, 500)}`, 502, 'SCRIPT_HTTP_FAILED');
    } finally {
      clearTimeout(abortTimer);
    }
  }

  async openTransaction(datasource, deadline, transactions) {
    const handle = await this.driverManager.openTransaction(datasource, {
      timeoutMs: remainingMs(deadline)
    });
    const txId = `tx_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    transactions.set(txId, handle);
    return txId;
  }

  async directQuery(datasource, sql, params, deadline) {
    const rendered = renderScriptSql(sql, params, datasource.type);
    return this.driverManager.execute(datasource, rendered.sql, rendered.values, {
      timeoutMs: remainingMs(deadline)
    });
  }
}

async function handleRpc(message, context) {
  const { datasource, deadline, transactions } = context;
  const service = context.service;
  if (message.type === 'db.begin') {
    return await service.openTransaction(datasource, deadline, transactions);
  }
  if (message.type === 'db.query' || message.type === 'db.queryOne' || message.type === 'db.execute') {
    const result = await service.directQuery(
      datasource,
      message.sql,
      message.params,
      deadline
    );
    if (message.type === 'db.execute') return result;
    return result.rows;
  }
  if (message.type === 'db.transactionQuery' || message.type === 'db.transactionExecute') {
    const handle = transactions.get(message.txId);
    if (!handle) throw new AppError('数据库事务不存在或已结束', 500, 'DB_TRANSACTION_CLOSED');
    const rendered = renderScriptSql(message.sql, message.params, datasource.type);
    const result = await handle.execute(rendered.sql, rendered.values);
    return message.type === 'db.transactionExecute' ? result : result.rows;
  }
  if (message.type === 'db.commit' || message.type === 'db.rollback') {
    const handle = transactions.get(message.txId);
    if (!handle) throw new AppError('数据库事务不存在或已结束', 500, 'DB_TRANSACTION_CLOSED');
    try {
      if (message.type === 'db.commit') await handle.commit();
      else await handle.rollback();
    } finally {
      transactions.delete(message.txId);
      await handle.close();
    }
    return null;
  }
  if (message.type === 'http.fetch') {
    return await service.handleHttp({
      endpoint: context.endpoint,
      url: message.url,
      options: message.options,
      deadline
    });
  }
  if (message.type === 'plugin.call') {
    const pluginContext = createPluginContext(context);
    return await service.pluginRegistry.call(
      message.name,
      message.action,
      message.args,
      pluginContext
    );
  }
  throw new AppError(`未知脚本调用：${message.type}`, 500, 'SCRIPT_RPC_UNKNOWN');
}

function createPluginContext(context) {
  const service = context.service;
  const db = {
    async query(sql, params = {}) {
      const result = await service.directQuery(
        context.datasource,
        sql,
        params,
        context.deadline
      );
      return result.rows;
    },
    async queryOne(sql, params = {}) {
      const rows = await db.query(sql, params);
      return rows[0] ?? null;
    },
    execute(sql, params = {}) {
      return service.directQuery(
        context.datasource,
        sql,
        params,
        context.deadline
      );
    }
  };
  return {
    params: context.params,
    request: sanitizeRequest(context.sources),
    endpoint: {
      id: context.endpoint.id,
      name: context.endpoint.name
    },
    db,
    http: {
      fetch(url, options = {}) {
        return service.handleHttp({
          endpoint: context.endpoint,
          url,
          options,
          deadline: context.deadline
        });
      }
    },
    logger: {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {}
    }
  };
}

async function cleanupTransactions(transactions) {
  for (const [id, handle] of transactions) {
    transactions.delete(id);
    try {
      await handle.rollback();
    } catch {}
    await handle.close().catch(() => {});
  }
}

function remainingMs(deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new AppError('脚本执行已超时', 504, 'SCRIPT_TIMEOUT');
  return Math.max(1, remaining);
}

function sanitizeRequest(sources = {}) {
  const headers = { ...(sources.headers || {}) };
  for (const name of ['authorization', 'cookie', 'x-api-token', 'x-admin-token']) {
    delete headers[name];
  }
  return {
    query: sources.query || {},
    body: sources.body || {},
    path: sources.path || {},
    headers
  };
}

function validateHttpTarget(rawUrl, allowlist) {
  let target;
  try {
    target = new URL(String(rawUrl));
  } catch {
    throw new ValidationError('外部 HTTP URL 无效');
  }
  if (!['http:', 'https:'].includes(target.protocol)) {
    throw new ValidationError('外部 HTTP 只支持 http 和 https');
  }
  if (!isAllowedHost(target.host, allowlist)) {
    throw new AppError(`外部 HTTP 域名不在白名单：${target.host}`, 403, 'SCRIPT_HTTP_HOST_DENIED');
  }
  return target.href;
}

function isAllowedHost(host, allowlist) {
  const normalized = host.toLowerCase();
  return allowlist.some((entry) => {
    const rule = String(entry).trim().toLowerCase();
    if (!rule) return false;
    try {
      const parsed = new URL(rule.includes('://') ? rule : `http://${rule}`);
      const ruleHost = parsed.host;
      if (ruleHost.startsWith('*.')) return normalized.endsWith(ruleHost.slice(1));
      return normalized === ruleHost;
    } catch {
      return false;
    }
  });
}

function normalizeHttpHeaders(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const headers = {};
  for (const [name, item] of Object.entries(value)) {
    const key = String(name).toLowerCase();
    if (['host', 'content-length', 'connection'].includes(key)) continue;
    headers[key] = String(item);
  }
  return headers;
}
