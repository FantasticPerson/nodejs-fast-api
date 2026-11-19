import { randomUUID } from 'node:crypto';
import {
  ConflictError,
  NotFoundError,
  ValidationError
} from '../errors.js';
import {
  endpointPathParams,
  endpointPathSignature,
  normalizeEndpointPath
} from '../path.js';
import { compileTemplate, containsRawExpression, TemplateError } from '../sql/template.js';
import { MAX_QUERY_TIMEOUT_MS } from '../timeout.js';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const LOCATIONS = new Set(['query', 'body', 'path', 'header']);
const PARAM_TYPES = new Set(['string', 'number', 'boolean', 'date', 'json', 'array']);
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export class EndpointService {
  constructor({ store }) {
    this.store = store;
    this.templateCache = new Map();
  }

  list() {
    return this.store.listEndpoints();
  }

  get(id) {
    const endpoint = this.store.findEndpoint(id);
    if (!endpoint) throw new NotFoundError('接口不存在');
    return endpoint;
  }

  async create(input) {
    const now = new Date().toISOString();
    const state = this.store.validationState();
    const core = normalizeEndpointCore(input, state);
    assertPathAvailable(state, [core], null);
    const created = buildRecord(core, {
      now,
      id: `api_${randomUUID().replace(/-/g, '').slice(0, 12)}`
    });
    return this.store.insertEndpoints([created])[0];
  }

  async createMany(inputs) {
    if (!Array.isArray(inputs) || !inputs.length) throw new ValidationError('没有可创建的接口');
    const now = new Date().toISOString();
    const state = this.store.validationState();
    const cores = inputs.map((input) => normalizeEndpointCore(input, state));
    assertBatchPathsAvailable(state, cores);
    const records = cores.map((core) =>
      buildRecord(core, { now, id: `api_${randomUUID().replace(/-/g, '').slice(0, 12)}` })
    );
    this.store.insertEndpoints(records);
    return records;
  }

  async update(id, input) {
    const existing = this.store.findEndpoint(id);
    if (!existing) throw new NotFoundError('接口不存在');
    const now = new Date().toISOString();
    const state = this.store.validationState();
    const core = normalizeEndpointCore(input, state);
    assertPathAvailable(state, [core], id);
    const updated = buildRecord(core, {
      now,
      id,
      createdAt: existing.createdAt,
      callCount: existing.callCount || 0,
      lastCalledAt: existing.lastCalledAt || null
    });
    const record = this.store.updateEndpoint(id, updated);
    this.templateCache.delete(id);
    return record;
  }

  async remove(id) {
    const existing = this.store.findEndpoint(id);
    if (!existing) throw new NotFoundError('接口不存在');
    await this.store.deleteEndpoint(id);
    this.templateCache.delete(id);
  }

  getTemplate(endpoint) {
    const cacheKey = `${endpoint.id}:${endpoint.updatedAt}:${endpoint.sql.length}:${endpoint.sql.slice(0, 24)}`;
    const cached = this.templateCache.get(endpoint.id);
    if (cached?.key === cacheKey) return cached.ast;
    let ast;
    try {
      ast = compileTemplate(endpoint.sql);
    } catch (error) {
      if (error instanceof TemplateError) throw new ValidationError(error.message);
      throw error;
    }
    this.templateCache.set(endpoint.id, { key: cacheKey, ast });
    return ast;
  }

  async recordCall(id) {
    this.store.recordCall(id);
  }
}

function normalizeEndpointCore(input = {}, state) {
  const method = String(input.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new ValidationError('HTTP 方法不受支持');
  const path = normalizeEndpointPath(input.path);
  const datasourceId = String(input.datasourceId || '').trim();
  if (!datasourceId) throw new ValidationError('必须选择数据源');
  if (!state.datasources.some((item) => item.id === datasourceId)) {
    throw new ValidationError('选择的数据源不存在');
  }
  const sql = String(input.sql || '').trim();
  if (!sql) throw new ValidationError('SQL 不能为空');
  const allowRawSql = Boolean(input.allowRawSql);
  if (!allowRawSql && containsRawExpression(sql)) {
    throw new ValidationError('SQL 中包含 ${} 原样拼接，请先开启“允许原样 SQL”');
  }
  try {
    compileTemplate(sql);
  } catch (error) {
    if (error instanceof TemplateError) throw new ValidationError(error.message);
    throw error;
  }

  const params = normalizeParams(input.params, path);
  const name = String(input.name || '').trim() || `${method} ${path}`;
  if (name.length > 120) throw new ValidationError('接口名称不能超过 120 个字符');
  const description = String(input.description || '').trim();
  if (description.length > 2000) throw new ValidationError('接口描述不能超过 2000 个字符');
  const group = String(input.group || '').trim();
  if (group.length > 60) throw new ValidationError('分组名称不能超过 60 个字符');
  const responseMode = input.responseMode === 'raw' ? 'raw' : 'wrap';
  const paginationInput = input.pagination || {};
  const pagination = {
    enabled: Boolean(paginationInput.enabled),
    maxPageSize: clampInteger(paginationInput.maxPageSize, 100, 1, 5000)
  };

  return {
    name,
    method,
    path,
    datasourceId,
    sql,
    description,
    group,
    enabled: input.enabled !== false,
    allowRawSql,
    timeoutMs: normalizeTimeout(input.timeoutMs),
    params,
    pagination,
    responseMode
  };
}

function normalizeTimeout(value) {
  if (value === undefined || value === null || value === '') return 0;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > MAX_QUERY_TIMEOUT_MS) {
    throw new ValidationError(`接口超时必须是 0 到 ${MAX_QUERY_TIMEOUT_MS} 的整数毫秒`);
  }
  return number;
}

function buildRecord(core, { now, id, createdAt = now, callCount = 0, lastCalledAt = null }) {
  return {
    id,
    ...core,
    createdAt,
    updatedAt: now,
    callCount,
    lastCalledAt
  };
}

function normalizeParams(rawParams, path) {
  const params = [];
  const seen = new Set();
  if (rawParams !== undefined && !Array.isArray(rawParams)) {
    throw new ValidationError('参数配置必须是数组');
  }
  for (const input of rawParams || []) {
    const name = String(input?.name || '').trim();
    if (!PARAM_NAME.test(name)) throw new ValidationError(`参数名无效：${name || '(空)'}`);
    if (seen.has(name)) throw new ValidationError(`参数名重复：${name}`);
    seen.add(name);
    const location = String(input.in || 'query').toLowerCase();
    if (!LOCATIONS.has(location)) throw new ValidationError(`参数位置无效：${location}`);
    const type = String(input.type || 'string').toLowerCase();
    if (!PARAM_TYPES.has(type)) throw new ValidationError(`参数类型无效：${type}`);
    const defaultValue =
      input.defaultValue === undefined || input.defaultValue === null || input.defaultValue === ''
        ? null
        : String(input.defaultValue);
    params.push({
      name,
      in: location,
      type,
      required: Boolean(input.required),
      defaultValue,
      description: String(input.description || '').trim().slice(0, 300)
    });
  }

  for (const name of endpointPathParams(path)) {
    if (seen.has(name)) {
      const param = params.find((item) => item.name === name);
      if (param.in !== 'path') throw new ValidationError(`路径参数 ${name} 的来源必须是 path`);
      param.required = true;
      continue;
    }
    params.push({
      name,
      in: 'path',
      type: 'string',
      required: true,
      defaultValue: null,
      description: '路径参数（自动补充）'
    });
  }
  return params;
}

function assertPathAvailable(state, records, currentId) {
  for (const record of records) {
    const conflict = state.endpoints.find(
      (endpoint) =>
        endpoint.id !== currentId &&
        endpoint.method === record.method &&
        endpointPathSignature(endpoint.path) === endpointPathSignature(record.path)
    );
    if (conflict) {
      throw new ConflictError(
        `接口路径冲突：${record.method} ${record.path} 已被 ${conflict.name} 使用`,
        { endpointId: conflict.id }
      );
    }
  }
}

function assertBatchPathsAvailable(state, records) {
  const keys = new Set();
  for (const record of records) {
    const key = `${record.method}:${endpointPathSignature(record.path)}`;
    if (keys.has(key)) throw new ConflictError(`生成结果中存在重复接口：${record.method} ${record.path}`);
    keys.add(key);
  }
  for (const record of records) assertPathAvailable(state, [record], null);
}

function clampInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}
