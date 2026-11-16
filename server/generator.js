import { randomUUID } from 'node:crypto';
import { ValidationError } from './errors.js';
import { isSearchableColumn } from './metadata.js';
import { normalizeEndpointPath } from './path.js';
import { quoteIdentifier, quoteTable } from './sql/identifiers.js';

const METHOD_ORDER = ['list', 'get', 'create', 'update', 'delete'];
const QUERY_METHODS = ['list', 'get'];
const WRITE_METHODS = new Set(['create', 'update', 'delete']);

export function buildCrudDefinitions({ datasource, table, pathBase, methods }) {
  const requested = methods?.length ? methods : null;
  if (requested && datasource.readOnly && requested.some((method) => WRITE_METHODS.has(method))) {
    throw new ValidationError('数据源已启用只读模式，只能生成查询接口');
  }
  const selected = new Set(requested || (datasource.readOnly ? QUERY_METHODS : METHOD_ORDER));
  for (const method of selected) {
    if (!METHOD_ORDER.includes(method)) throw new ValidationError(`未知的 CRUD 方法：${method}`);
  }

  const primaryKey = table.primaryKeys?.[0] || null;
  const requiresPrimaryKey = ['get', 'update', 'delete'].some((method) => selected.has(method));
  if (requiresPrimaryKey && !primaryKey) {
    throw new ValidationError('该表没有主键，只能生成列表和新增接口');
  }
  if (table.primaryKeys?.length > 1 && requiresPrimaryKey) {
    throw new ValidationError('暂不支持联合主键，请使用自定义 SQL 接口');
  }

  const dialect = datasource.type === 'oracle' ? 'oracle' : 'mysql';
  const tableRef = quoteTable(table, dialect);
  const columns = table.columns || [];
  const pkColumn = primaryKey ? columns.find((column) => column.name === primaryKey) : null;
  const nonPkColumns = columns.filter((column) => column.name !== primaryKey);
  const insertColumns = columns.filter((column) => !column.autoIncrement);
  const updateColumns = nonPkColumns.filter((column) => !column.autoIncrement);
  const selectSql = `SELECT ${columns.map((column) => quoteIdentifier(column.name, dialect)).join(', ')}\nFROM ${tableRef}`;
  const base = normalizePathBase(pathBase || `/${slugifyTable(table.name)}`);
  const group = table.name;
  const now = new Date().toISOString();
  const definitions = [];

  if (selected.has('list')) {
    definitions.push(
      endpoint({
        name: `${table.name} 列表`,
        method: 'GET',
        path: base,
        sql: buildListSql({ dialect, selectSql, columns, pkColumn }),
        description: '分页查询列表，支持关键字搜索。',
        params: [
          ...(columns.some(isSearchableColumn)
            ? [param('keyword', 'query', 'string', false, null, '关键字搜索')]
            : []),
          param('page', 'query', 'number', false, '1', '页码，从 1 开始'),
          param('pageSize', 'query', 'number', false, '20', '每页条数')
        ],
        pagination: { enabled: true, maxPageSize: 100 },
        group,
        now
      })
    );
  }

  if (selected.has('get')) {
    definitions.push(
      endpoint({
        name: `${table.name} 详情`,
        method: 'GET',
        path: `${base}/:${primaryKey}`,
        sql: `${selectSql}\nWHERE ${quoteIdentifier(primaryKey, dialect)} = #{${primaryKey}}`,
        description: `按主键 ${primaryKey} 查询单条记录。`,
        params: [pkParam(pkColumn)],
        group,
        now
      })
    );
  }

  if (selected.has('create')) {
    if (!insertColumns.length) throw new ValidationError('该表没有可插入字段');
    definitions.push(
      endpoint({
        name: `${table.name} 新增`,
        method: 'POST',
        path: base,
        sql: buildInsertSql({ dialect, tableRef, insertColumns }),
        description: `新增一条 ${table.name} 记录。`,
        params: insertColumns.map((column) => columnParam(column, true)),
        group,
        now
      })
    );
  }

  if (selected.has('update')) {
    if (!updateColumns.length) throw new ValidationError('该表没有可更新字段');
    definitions.push(
      endpoint({
        name: `${table.name} 更新`,
        method: 'PUT',
        path: `${base}/:${primaryKey}`,
        sql: buildUpdateSql({ dialect, tableRef, updateColumns, primaryKey }),
        description: `按主键 ${primaryKey} 更新记录，未提交的字段保持原值。`,
        params: [
          pkParam(pkColumn),
          ...updateColumns.map((column) => columnParam(column, false))
        ],
        group,
        now
      })
    );
  }

  if (selected.has('delete')) {
    definitions.push(
      endpoint({
        name: `${table.name} 删除`,
        method: 'DELETE',
        path: `${base}/:${primaryKey}`,
        sql: `DELETE FROM ${tableRef}\nWHERE ${quoteIdentifier(primaryKey, dialect)} = #{${primaryKey}}`,
        description: `按主键 ${primaryKey} 删除记录。`,
        params: [pkParam(pkColumn)],
        group,
        now
      })
    );
  }

  return {
    pathBase: base,
    endpoints: definitions.map((item) => ({ ...item, datasourceId: datasource.id }))
  };
}

export function slugifyTable(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'resource';
}

function buildListSql({ dialect, selectSql, columns, pkColumn }) {
  const searchable = columns.filter(isSearchableColumn).slice(0, 6);
  let sql = selectSql;
  if (searchable.length) {
    const likeParts = searchable.map((column) => {
      const quoted = quoteIdentifier(column.name, dialect);
      return dialect === 'oracle'
        ? `${quoted} LIKE '%' || #{keyword} || '%'`
        : `${quoted} LIKE CONCAT('%', #{keyword}, '%')`;
    });
    sql += `\n<if test="keyword != null and keyword != ''">\nWHERE (${likeParts.join('\n  OR ')})`;
    sql += `\n</if>`;
  }
  if (pkColumn) {
    sql += `\nORDER BY ${quoteIdentifier(pkColumn.name, dialect)} DESC`;
  }
  return sql;
}

function buildInsertSql({ dialect, tableRef, insertColumns }) {
  const fields = insertColumns.map((column) => quoteIdentifier(column.name, dialect)).join(', ');
  const values = insertColumns.map((column) => `#{${column.name}}`).join(', ');
  return `INSERT INTO ${tableRef} (${fields})\nVALUES (${values})`;
}

function buildUpdateSql({ dialect, tableRef, updateColumns, primaryKey }) {
  const assignments = updateColumns
    .map((column) => {
      const quoted = quoteIdentifier(column.name, dialect);
      return `${quoted} = COALESCE(#{${column.name}}, ${quoted})`;
    })
    .join(',\n  ');
  return `UPDATE ${tableRef}\nSET ${assignments}\nWHERE ${quoteIdentifier(primaryKey, dialect)} = #{${primaryKey}}`;
}

function endpoint({ name, method, path, sql, description, params, pagination, group, now }) {
  return {
    id: `generated_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
    name,
    method,
    path,
    datasourceId: '',
    sql,
    description,
    group,
    enabled: true,
    allowRawSql: false,
    params,
    pagination: pagination || { enabled: false, maxPageSize: 100 },
    responseMode: 'wrap',
    createdAt: now,
    updatedAt: now,
    callCount: 0,
    lastCalledAt: null
  };
}

function param(name, location, type, required, defaultValue, description = '') {
  return { name, in: location, type, required, defaultValue, description };
}

function pkParam(column) {
  return param(column.name, 'path', column.kind === 'binary' ? 'string' : column.kind, true, null, '主键');
}

function columnParam(column, isInsert) {
  const hasDefault = column.defaultValue !== null && String(column.defaultValue).trim() !== '';
  const required = isInsert && !column.nullable && !hasDefault && !column.autoIncrement;
  return {
    name: column.name,
    in: 'body',
    type: column.kind === 'binary' ? 'string' : column.kind,
    required,
    defaultValue: null,
    description: `${column.dataType}${column.nullable ? ' · 可空' : ''}`
  };
}

function normalizePathBase(value) {
  const path = normalizeEndpointPath(value);
  return path.replace(/\/+$/, '') || '/';
}
