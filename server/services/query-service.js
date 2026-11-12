import { AppError, ValidationError } from '../errors.js';
import { renderTemplate, TemplateError } from '../sql/template.js';
import { truncate } from '../utils.js';

const PARAM_TYPES = new Set(['string', 'number', 'boolean', 'date', 'json', 'array']);
const ORACLE_PAGE_MARKER = '__magic_row_number';

export class QueryService {
  constructor({ driverManager, endpointService }) {
    this.driverManager = driverManager;
    this.endpointService = endpointService;
  }

  async execute({ endpoint, datasource, sources }) {
    const built = buildContext(endpoint, sources);
    const rendered = this.render({ endpoint, datasource, context: built.context });
    const isSelect = isSelectSql(rendered.sql);

    try {
      if (isSelect && endpoint.pagination?.enabled) {
        return await this.executePaginated({ endpoint, datasource, rendered, built, isSelect });
      }
      if (isSelect) {
        const result = await this.driverManager.execute(datasource, rendered.sql, rendered.values);
        return result.rows;
      }
      const result = await this.driverManager.execute(datasource, rendered.sql, rendered.values);
      return {
        affectedRows: result.affectedRows,
        insertId: result.insertId ?? null
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `数据库执行失败：${truncate(error?.message || error, 500)}`,
        502,
        'DB_EXECUTION_FAILED'
      );
    }
  }

  render({ endpoint, datasource, sources, context }) {
    const runtimeContext = context || buildContext(endpoint, sources).context;
    const dialect = datasource.type === 'oracle' ? 'oracle' : 'mysql';
    let rendered;
    try {
      rendered = renderTemplate(this.endpointService.getTemplate(endpoint), runtimeContext, {
        dialect,
        allowRawSql: Boolean(endpoint.allowRawSql)
      });
    } catch (error) {
      if (error instanceof TemplateError) throw new ValidationError(error.message);
      throw error;
    }
    const sql = trimSql(rendered.sql);
    if (!sql) throw new ValidationError('SQL 渲染结果为空');
    return {
      dialect,
      sql,
      values: rendered.values,
      isSelect: isSelectSql(sql)
    };
  }

  preview({ endpoint, datasource, sources }) {
    const built = buildContext(endpoint, sources);
    const rendered = this.render({ endpoint, datasource, context: built.context });
    return {
      sql: rendered.sql,
      values: rendered.values,
      dialect: rendered.dialect,
      isSelect: rendered.isSelect,
      page: built.page,
      pageSize: built.pageSize
    };
  }

  async executePaginated({ endpoint, datasource, rendered, built }) {
    const { page, pageSize } = built;
    const total = await this.countRows(datasource, rendered);
    const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0;
    if (total === 0 || page > totalPages) {
      return { list: [], total, page, pageSize, totalPages };
    }
    const paged = appendPagination(rendered, page, pageSize);
    const result = await this.driverManager.execute(datasource, paged.sql, paged.values);
    return {
      list:
        rendered.dialect === 'oracle'
          ? result.rows.map(stripOraclePageMarker)
          : result.rows,
      total,
      page,
      pageSize,
      totalPages
    };
  }

  async countRows(datasource, rendered) {
    const countSql =
      rendered.dialect === 'oracle'
        ? `SELECT COUNT(*) AS "__magic_total" FROM (${rendered.sql}) "__magic_sub"`
        : `SELECT COUNT(*) AS __magic_total FROM (${rendered.sql}) AS __magic_sub`;
    const result = await this.driverManager.execute(datasource, countSql, rendered.values);
    const row = result.rows[0] || {};
    const key = Object.keys(row).find((item) => item.toLowerCase() === '__magic_total');
    return Number(key ? row[key] : 0) || 0;
  }
}

export function buildContext(endpoint, sources = {}) {
  const query = sources.query || {};
  const body = sources.body || {};
  const path = sources.path || {};
  const headers = sources.headers || {};
  const context = {};

  for (const param of endpoint.params || []) {
    let raw = readParamValue(param, { query, body, path, headers });
    if (raw === undefined || raw === null) {
      if (param.defaultValue !== null && param.defaultValue !== undefined) {
        raw = param.defaultValue;
      } else if (param.required) {
        throw new ValidationError(`缺少必填参数：${param.name}`);
      } else {
        context[param.name] = null;
        continue;
      }
    }
    context[param.name] = coerceValue(raw, param.type, param.name);
  }

  addUnspecified(context, query);
  addUnspecified(context, body);
  addUnspecified(context, path);

  const page = normalizeInteger(context.page ?? query.page, 1, 1, 1_000_000);
  const maxPageSize = endpoint.pagination?.maxPageSize || 100;
  const pageSize = normalizeInteger(context.pageSize ?? query.pageSize, 20, 1, maxPageSize);
  context.page = page;
  context.pageSize = pageSize;
  return { context, page, pageSize };
}

function addUnspecified(context, source) {
  if (!source || typeof source !== 'object') return;
  for (const [key, value] of Object.entries(source)) {
    if (!(key in context)) context[key] = value;
  }
}

function readParamValue(param, sources) {
  const name = param.name;
  if (param.in === 'header') return sources.headers[String(name).toLowerCase()];
  if (param.in === 'body') return sources.body[name];
  if (param.in === 'path') return sources.path[name];
  return sources.query[name];
}

export function coerceValue(value, type, name = '参数') {
  if (value === undefined || value === null) return null;
  if (!PARAM_TYPES.has(type)) throw new ValidationError(`参数 ${name} 类型无效：${type}`);

  if (type === 'array') {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      if (!value.trim()) return [];
      return value.split(',').map((item) => item.trim());
    }
    return [value];
  }
  if (type === 'number') {
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new ValidationError(`参数 ${name} 必须是有效数字`);
      return value;
    }
    if (typeof value === 'string' && !value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number)) throw new ValidationError(`参数 ${name} 必须是有效数字`);
    return number;
  }
  if (type === 'boolean') {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    const normalized = String(value).trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
    throw new ValidationError(`参数 ${name} 必须是布尔值`);
  }
  if (type === 'json') {
    if (typeof value === 'string') {
      try {
        return JSON.stringify(JSON.parse(value));
      } catch {
        throw new ValidationError(`参数 ${name} 不是有效 JSON`);
      }
    }
    try {
      return JSON.stringify(value);
    } catch {
      throw new ValidationError(`参数 ${name} 无法序列化为 JSON`);
    }
  }
  if (type === 'date') {
    if (value instanceof Date) return value;
    const text = String(value).trim();
    if (!text) return null;
    return text;
  }
  return String(value);
}

function normalizeInteger(value, fallback, min, max) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function appendPagination(rendered, page, pageSize) {
  const offset = (page - 1) * pageSize;
  if (rendered.dialect === 'oracle') {
    const highBind = rendered.values.length;
    const lowBind = highBind + 1;
    const high = offset + pageSize;
    return {
      sql: `SELECT "__magic_page".*
FROM (
  SELECT "__magic_rows".*, ROWNUM AS "${ORACLE_PAGE_MARKER}"
  FROM (
${rendered.sql}
  ) "__magic_rows"
  WHERE ROWNUM <= :p${highBind}
) "__magic_page"
WHERE "__magic_page"."${ORACLE_PAGE_MARKER}" > :p${lowBind}`,
      values: [...rendered.values, high, offset]
    };
  }
  return {
    sql: `${rendered.sql}\nLIMIT ? OFFSET ?`,
    values: [...rendered.values, pageSize, offset]
  };
}

function stripOraclePageMarker(row) {
  if (!row || typeof row !== 'object') return row;
  const marker = Object.keys(row).find(
    (key) => key.toLowerCase() === ORACLE_PAGE_MARKER
  );
  if (!marker) return row;
  const output = { ...row };
  delete output[marker];
  return output;
}

export function isSelectSql(sql) {
  return /^\s*(select|with|explain)\b/i.test(sql);
}

export function trimSql(sql) {
  return String(sql || '').trim().replace(/;\s*$/, '').trim();
}
