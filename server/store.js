import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  endpointPathSignature,
  endpointRouteScore,
  normalizeEndpointPath
} from './path.js';

const SCHEMA_VERSION = '3';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS datasources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('mysql', 'oracle')),
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  username TEXT NOT NULL,
  password_enc TEXT,
  database_name TEXT NOT NULL DEFAULT '',
  service_name TEXT NOT NULL DEFAULT '',
  connect_string TEXT NOT NULL DEFAULT '',
  connection_type TEXT NOT NULL DEFAULT '',
  schema_name TEXT NOT NULL DEFAULT '',
  read_only INTEGER NOT NULL DEFAULT 0 CHECK (read_only IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS endpoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path TEXT NOT NULL,
  path_signature TEXT NOT NULL,
  datasource_id TEXT NOT NULL REFERENCES datasources(id) ON DELETE RESTRICT,
  sql TEXT NOT NULL,
  engine TEXT NOT NULL DEFAULT 'sql',
  script_code TEXT NOT NULL DEFAULT '',
  allow_http INTEGER NOT NULL DEFAULT 0 CHECK (allow_http IN (0, 1)),
  description TEXT NOT NULL DEFAULT '',
  group_name TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  allow_raw_sql INTEGER NOT NULL DEFAULT 0 CHECK (allow_raw_sql IN (0, 1)),
  timeout_ms INTEGER NOT NULL DEFAULT 0,
  pagination_enabled INTEGER NOT NULL DEFAULT 0 CHECK (pagination_enabled IN (0, 1)),
  pagination_max_page_size INTEGER NOT NULL DEFAULT 100,
  response_mode TEXT NOT NULL DEFAULT 'wrap' CHECK (response_mode IN ('wrap', 'raw')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (method, path_signature)
);

CREATE TABLE IF NOT EXISTS endpoint_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (endpoint_id, version)
);

CREATE TABLE IF NOT EXISTS script_libraries (
  name TEXT PRIMARY KEY COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  code TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS script_library_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL REFERENCES script_libraries(name) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  definition_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (name, version)
);

CREATE TABLE IF NOT EXISTS endpoint_params (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint_id TEXT NOT NULL REFERENCES endpoints(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  location TEXT NOT NULL CHECK (location IN ('query', 'body', 'path', 'header')),
  type TEXT NOT NULL CHECK (type IN ('string', 'number', 'boolean', 'date', 'json', 'array')),
  required INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  default_value TEXT,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE (endpoint_id, name)
);

CREATE TABLE IF NOT EXISTS endpoint_stats (
  endpoint_id TEXT PRIMARY KEY REFERENCES endpoints(id) ON DELETE CASCADE,
  call_count INTEGER NOT NULL DEFAULT 0,
  last_called_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_endpoints_datasource ON endpoints(datasource_id);
CREATE INDEX IF NOT EXISTS idx_endpoint_versions_endpoint ON endpoint_versions(endpoint_id, version);
CREATE INDEX IF NOT EXISTS idx_script_library_versions_name ON script_library_versions(name, version);
`;

const DATASOURCE_COLUMNS = `
  id, name, type, host, port, username, password_enc,
  database_name, service_name, connect_string, connection_type, schema_name,
  read_only, created_at, updated_at
`;

const ENDPOINT_COLUMNS = `
  id, name, method, path, path_signature, datasource_id, sql, engine, script_code, allow_http,
  description, group_name, enabled, allow_raw_sql, timeout_ms,
  pagination_enabled, pagination_max_page_size, response_mode,
  created_at, updated_at
`;

const INSERT_DATASOURCE_SQL = `
INSERT INTO datasources (${DATASOURCE_COLUMNS})
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_DATASOURCE_SQL = `
UPDATE datasources SET
  name = ?, type = ?, host = ?, port = ?, username = ?, password_enc = ?,
  database_name = ?, service_name = ?, connect_string = ?, connection_type = ?,
  schema_name = ?, read_only = ?, created_at = ?, updated_at = ?
WHERE id = ?
`;

const INSERT_ENDPOINT_SQL = `
INSERT INTO endpoints (${ENDPOINT_COLUMNS})
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPDATE_ENDPOINT_SQL = `
UPDATE endpoints SET
  name = ?, method = ?, path = ?, path_signature = ?, datasource_id = ?, sql = ?,
  engine = ?, script_code = ?, allow_http = ?,
  description = ?, group_name = ?, enabled = ?, allow_raw_sql = ?, timeout_ms = ?,
  pagination_enabled = ?, pagination_max_page_size = ?, response_mode = ?,
  created_at = ?, updated_at = ?
WHERE id = ?
`;

const UPSERT_STATS_SQL = `
INSERT INTO endpoint_stats (endpoint_id, call_count, last_called_at)
VALUES (?, ?, ?)
ON CONFLICT(endpoint_id) DO UPDATE SET
  call_count = excluded.call_count,
  last_called_at = excluded.last_called_at
`;

const PARAM_TYPES = new Set(['string', 'number', 'boolean', 'date', 'json', 'array']);
const PARAM_LOCATIONS = new Set(['query', 'body', 'path', 'header']);

export class SqliteStore {
  constructor(filePath, { legacyStateFile = '' } = {}) {
    this.filePath = filePath;
    this.legacyStateFile = legacyStateFile;
    this.db = null;
    this.closed = false;
    this.datasources = [];
    this.datasourcesById = new Map();
    this.endpoints = [];
    this.endpointsById = new Map();
    this.endpointCountsByDatasource = new Map();
    this.scriptLibraries = [];
    this.scriptLibrariesByName = new Map();
    this.runtimeEndpoints = [];
    this.dirtyStats = new Set();
    this.statements = null;
  }

  async init() {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      this.db = new DatabaseSync(this.filePath);
      this.db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `);
      this.db.exec(SCHEMA_SQL);
      this.ensureSchemaColumns();
      await this.securePermissions();
      this.prepareStatements();
      await this.initializeMetadata();
      this.loadCaches();
      return this;
    } catch (error) {
      this.db?.close();
      this.db = null;
      throw error;
    }
  }

  listDatasources() {
    return this.datasources;
  }

  findDatasource(id) {
    return this.datasourcesById.get(id) || null;
  }

  countEndpointsByDatasource(id) {
    return this.endpointCountsByDatasource.get(id) || 0;
  }

  findEndpointsByDatasource(id) {
    return this.endpoints.filter((endpoint) => endpoint.datasourceId === id);
  }

  listEndpoints() {
    return this.endpoints;
  }

  findEndpoint(id) {
    return this.endpointsById.get(id) || null;
  }

  listEndpointVersions(id) {
    return this.db
      .prepare('SELECT * FROM endpoint_versions WHERE endpoint_id = ? ORDER BY version DESC')
      .all(id)
      .map(endpointVersionFromRow);
  }

  findEndpointVersion(id, version) {
    const row = this.db
      .prepare('SELECT * FROM endpoint_versions WHERE endpoint_id = ? AND version = ?')
      .get(id, Number(version));
    return row ? endpointVersionFromRow(row) : null;
  }

  listScriptLibraries() {
    return this.scriptLibraries;
  }

  findScriptLibrary(name) {
    return this.scriptLibrariesByName.get(String(name).toLowerCase()) || null;
  }

  listScriptLibraryVersions(name) {
    return this.db
      .prepare('SELECT * FROM script_library_versions WHERE name = ? ORDER BY version DESC')
      .all(name)
      .map(scriptLibraryVersionFromRow);
  }

  findScriptLibraryVersion(name, version) {
    const row = this.db
      .prepare('SELECT * FROM script_library_versions WHERE name = ? AND version = ?')
      .get(name, Number(version));
    return row ? scriptLibraryVersionFromRow(row) : null;
  }

  getRuntimeEndpoints() {
    return this.runtimeEndpoints;
  }

  validationState() {
    return {
      datasources: this.datasources,
      endpoints: this.endpoints
    };
  }

  insertDatasource(input) {
    const record = canonicalDatasource(input);
    this.transaction(() => {
      this.statements.insertDatasource.run(...datasourceParams(record));
    });
    this.replaceDatasource(record);
    return record;
  }

  updateDatasource(id, input) {
    const existing = this.findDatasource(id);
    if (!existing) throw new Error(`数据源不存在：${id}`);
    const record = canonicalDatasource({ ...existing, ...input, id });
    this.transaction(() => {
      this.statements.updateDatasource.run(...datasourceUpdateParams(record));
    });
    this.replaceDatasource(record);
    return record;
  }

  deleteDatasource(id) {
    this.transaction(() => {
      this.statements.deleteDatasource.run(id);
    });
    this.datasources = this.datasources.filter((datasource) => datasource.id !== id);
    this.datasourcesById.delete(id);
    this.endpointCountsByDatasource.delete(id);
  }

  insertEndpoints(inputs) {
    const records = inputs.map((input) => canonicalEndpoint(input));
    this.transaction(() => {
      for (const record of records) this.insertEndpointRow(record);
    });
    for (const record of records) this.replaceEndpoint(record);
    return records;
  }

  insertScriptLibrary(input) {
    const record = canonicalScriptLibrary(input);
    this.transaction(() => {
      this.statements.insertScriptLibrary.run(...scriptLibraryParams(record));
      this.recordScriptLibraryVersion(record);
    });
    this.replaceScriptLibrary(record);
    return record;
  }

  updateScriptLibrary(name, input) {
    const existing = this.findScriptLibrary(name);
    if (!existing) throw new Error(`共享脚本不存在：${name}`);
    const record = canonicalScriptLibrary({
      ...existing,
      ...input,
      name: existing.name,
      createdAt: existing.createdAt
    });
    this.transaction(() => {
      this.statements.updateScriptLibrary.run(...scriptLibraryUpdateParams(record));
      this.recordScriptLibraryVersion(record);
    });
    this.replaceScriptLibrary(record);
    return record;
  }

  deleteScriptLibrary(name) {
    this.transaction(() => {
      this.statements.deleteScriptLibrary.run(name);
    });
    this.scriptLibraries = this.scriptLibraries.filter((item) => item.name !== name);
    this.scriptLibrariesByName.delete(name.toLowerCase());
  }

  updateEndpoint(id, input) {
    const existing = this.findEndpoint(id);
    if (!existing) throw new Error(`接口不存在：${id}`);
    const record = canonicalEndpoint({
      ...existing,
      ...input,
      id,
      callCount: input.callCount ?? existing.callCount,
      lastCalledAt: input.lastCalledAt ?? existing.lastCalledAt
    });
    this.transaction(() => {
      this.statements.updateEndpoint.run(...endpointUpdateParams(record));
      this.statements.deleteParams.run(id);
      this.insertParams(record);
      this.recordEndpointVersion(record);
    });
    this.replaceEndpoint(record);
    return record;
  }

  deleteEndpoint(id) {
    this.transaction(() => {
      this.statements.deleteEndpoint.run(id);
    });
    this.endpoints = this.endpoints.filter((endpoint) => endpoint.id !== id);
    this.endpointsById.delete(id);
    this.dirtyStats.delete(id);
    this.rebuildRuntimeIndex();
  }

  recordCall(id, calledAt = new Date().toISOString()) {
    const endpoint = this.endpointsById.get(id);
    if (!endpoint) return false;
    endpoint.callCount = Number(endpoint.callCount || 0) + 1;
    endpoint.lastCalledAt = calledAt;
    this.dirtyStats.add(id);
    return true;
  }

  flushStats() {
    if (!this.db || this.closed || this.dirtyStats.size === 0) return 0;
    const entries = [];
    for (const id of this.dirtyStats) {
      const endpoint = this.endpointsById.get(id);
      if (endpoint) entries.push(endpoint);
    }
    this.transaction(() => {
      for (const endpoint of entries) {
        this.statements.upsertStats.run(
          endpoint.id,
          Number(endpoint.callCount || 0),
          endpoint.lastCalledAt || null
        );
      }
    });
    this.dirtyStats.clear();
    return entries.length;
  }

  async close() {
    if (!this.db || this.closed) return;
    try {
      this.flushStats();
    } finally {
      this.db.close();
      this.db = null;
      this.closed = true;
    }
    await this.securePermissions();
  }

  async initializeMetadata() {
    if (this.getMeta('initialized') !== '1') {
      const counts = this.db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM datasources) AS datasource_count,
          (SELECT COUNT(*) FROM endpoints) AS endpoint_count
      `).get();
      if (Number(counts.datasource_count || 0) || Number(counts.endpoint_count || 0)) {
        throw new Error('SQLite 状态库包含数据但缺少初始化标记，请检查数据库文件');
      }

      const legacy = await this.readLegacyState();
      this.transaction(() => {
        if (legacy) {
          for (const datasource of legacy.datasources) this.insertDatasourceRow(datasource);
          for (const endpoint of legacy.endpoints) this.insertEndpointRow(endpoint);
          this.setMeta('legacy_imported_at', new Date().toISOString());
          this.setMeta('legacy_source', this.legacyStateFile);
        }
        this.setMeta('initialized', '1');
        this.setMeta('initialized_at', new Date().toISOString());
      });
    }
    this.transaction(() => {
      this.backfillEndpointVersions();
      this.setMeta('schema_version', SCHEMA_VERSION);
    });
  }

  backfillEndpointVersions() {
    const endpointIds = this.db.prepare(`
      SELECT e.id
      FROM endpoints e
      WHERE NOT EXISTS (
        SELECT 1 FROM endpoint_versions v WHERE v.endpoint_id = e.id
      )
    `).all();
    for (const { id } of endpointIds) {
      const row = this.db.prepare('SELECT * FROM endpoints WHERE id = ?').get(id);
      const params = this.db
        .prepare('SELECT * FROM endpoint_params WHERE endpoint_id = ? ORDER BY position')
        .all(id)
        .map((param) => canonicalParam(paramFromRow(param)));
      this.recordEndpointVersion(endpointFromRow(row, params, null));
    }
  }

  ensureSchemaColumns() {
    const columns = new Set(
      this.db.prepare('PRAGMA table_info(endpoints)').all().map((row) => row.name)
    );
    const additions = [
      ['engine', "TEXT NOT NULL DEFAULT 'sql'"],
      ['script_code', "TEXT NOT NULL DEFAULT ''"],
      ['allow_http', 'INTEGER NOT NULL DEFAULT 0']
    ];
    for (const [name, definition] of additions) {
      if (!columns.has(name)) {
        this.db.exec(`ALTER TABLE endpoints ADD COLUMN ${name} ${definition}`);
      }
    }
  }

  async readLegacyState() {
    if (!this.legacyStateFile) return null;
    let content;
    try {
      content = await fs.readFile(this.legacyStateFile, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`旧状态文件不是有效 JSON：${this.legacyStateFile}`);
    }
    return normalizeLegacyState(parsed);
  }

  loadCaches() {
    const datasourceRows = this.db
      .prepare('SELECT * FROM datasources ORDER BY created_at, id')
      .all();
    this.datasources = datasourceRows.map(datasourceFromRow);
    this.datasourcesById = new Map(
      this.datasources.map((datasource) => [datasource.id, datasource])
    );

    const endpointRows = this.db
      .prepare('SELECT * FROM endpoints ORDER BY created_at, id')
      .all();
    const paramRows = this.db
      .prepare('SELECT * FROM endpoint_params ORDER BY endpoint_id, position')
      .all();
    const statRows = this.db.prepare('SELECT * FROM endpoint_stats').all();
    const paramsByEndpoint = new Map();
    for (const row of paramRows) {
      const params = paramsByEndpoint.get(row.endpoint_id) || [];
      params.push(paramFromRow(row));
      paramsByEndpoint.set(row.endpoint_id, params);
    }
    const statsById = new Map(statRows.map((row) => [row.endpoint_id, row]));

    this.endpoints = endpointRows.map((row) =>
      endpointFromRow(row, paramsByEndpoint.get(row.id) || [], statsById.get(row.id))
    );
    this.endpointsById = new Map(this.endpoints.map((endpoint) => [endpoint.id, endpoint]));
    const libraryRows = this.db
      .prepare('SELECT * FROM script_libraries ORDER BY name')
      .all();
    this.scriptLibraries = libraryRows.map(scriptLibraryFromRow);
    this.scriptLibrariesByName = new Map(
      this.scriptLibraries.map((library) => [library.name.toLowerCase(), library])
    );
    this.dirtyStats.clear();
    this.rebuildRuntimeIndex();
  }

  prepareStatements() {
    this.statements = {
      insertDatasource: this.db.prepare(INSERT_DATASOURCE_SQL),
      updateDatasource: this.db.prepare(UPDATE_DATASOURCE_SQL),
      deleteDatasource: this.db.prepare('DELETE FROM datasources WHERE id = ?'),
      insertEndpoint: this.db.prepare(INSERT_ENDPOINT_SQL),
      updateEndpoint: this.db.prepare(UPDATE_ENDPOINT_SQL),
      deleteEndpoint: this.db.prepare('DELETE FROM endpoints WHERE id = ?'),
      deleteParams: this.db.prepare('DELETE FROM endpoint_params WHERE endpoint_id = ?'),
      insertParam: this.db.prepare(`
        INSERT INTO endpoint_params (
          endpoint_id, position, name, location, type, required, default_value, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `),
      upsertStats: this.db.prepare(UPSERT_STATS_SQL),
      insertEndpointVersion: this.db.prepare(`
        INSERT INTO endpoint_versions (endpoint_id, version, definition_json, created_at)
        VALUES (?, ?, ?, ?)
      `),
      insertScriptLibrary: this.db.prepare(`
        INSERT INTO script_libraries (name, description, code, enabled, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `),
      updateScriptLibrary: this.db.prepare(`
        UPDATE script_libraries SET description = ?, code = ?, enabled = ?,
          created_at = ?, updated_at = ?
        WHERE name = ?
      `),
      deleteScriptLibrary: this.db.prepare('DELETE FROM script_libraries WHERE name = ?'),
      insertScriptLibraryVersion: this.db.prepare(`
        INSERT INTO script_library_versions (name, version, definition_json, created_at)
        VALUES (?, ?, ?, ?)
      `)
    };
  }

  insertDatasourceRow(datasource) {
    this.statements.insertDatasource.run(...datasourceParams(datasource));
  }

  insertEndpointRow(endpoint) {
    this.statements.insertEndpoint.run(...endpointParams(endpoint));
    this.insertParams(endpoint);
    this.statements.upsertStats.run(
      endpoint.id,
      Number(endpoint.callCount || 0),
      endpoint.lastCalledAt || null
    );
    this.recordEndpointVersion(endpoint);
  }

  recordEndpointVersion(endpoint) {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM endpoint_versions WHERE endpoint_id = ?')
      .get(endpoint.id).version;
    this.statements.insertEndpointVersion.run(
      endpoint.id,
      next,
      JSON.stringify(endpointSnapshot(endpoint)),
      new Date().toISOString()
    );
  }

  recordScriptLibraryVersion(library) {
    const next = this.db
      .prepare('SELECT COALESCE(MAX(version), 0) + 1 AS version FROM script_library_versions WHERE name = ?')
      .get(library.name).version;
    this.statements.insertScriptLibraryVersion.run(
      library.name,
      next,
      JSON.stringify(library),
      new Date().toISOString()
    );
  }

  insertParams(endpoint) {
    endpoint.params.forEach((param, index) => {
      this.statements.insertParam.run(
        endpoint.id,
        index,
        param.name,
        param.in,
        param.type,
        param.required ? 1 : 0,
        param.defaultValue ?? null,
        param.description || ''
      );
    });
  }

  replaceDatasource(datasource) {
    const index = this.datasources.findIndex((item) => item.id === datasource.id);
    if (index >= 0) this.datasources[index] = datasource;
    else this.datasources.push(datasource);
    this.datasourcesById.set(datasource.id, datasource);
  }

  replaceScriptLibrary(library) {
    const index = this.scriptLibraries.findIndex((item) => item.name === library.name);
    if (index >= 0) this.scriptLibraries[index] = library;
    else this.scriptLibraries.push(library);
    this.scriptLibrariesByName.set(library.name.toLowerCase(), library);
  }

  replaceEndpoint(endpoint) {
    const index = this.endpoints.findIndex((item) => item.id === endpoint.id);
    if (index >= 0) this.endpoints[index] = endpoint;
    else this.endpoints.push(endpoint);
    this.endpointsById.set(endpoint.id, endpoint);
    this.rebuildRuntimeIndex();
  }

  rebuildRuntimeIndex() {
    this.endpointCountsByDatasource = new Map();
    for (const endpoint of this.endpoints) {
      const count = this.endpointCountsByDatasource.get(endpoint.datasourceId) || 0;
      this.endpointCountsByDatasource.set(endpoint.datasourceId, count + 1);
    }
    this.runtimeEndpoints = this.endpoints
      .filter((endpoint) => endpoint.enabled)
      .sort((left, right) => endpointRouteScore(right.path) - endpointRouteScore(left.path));
  }

  transaction(operation) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        this.db.exec('ROLLBACK');
      } catch {}
      throw error;
    }
  }

  getMeta(key) {
    return this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key)?.value ?? null;
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, String(value));
  }

  async securePermissions() {
    const candidates = [this.filePath, `${this.filePath}-wal`, `${this.filePath}-shm`];
    await Promise.all(
      candidates.map((candidate) => fs.chmod(candidate, 0o600).catch(() => {}))
    );
  }
}

function canonicalDatasource(input = {}) {
  const now = new Date().toISOString();
  const id = requiredText(input.id, '数据源 id');
  const name = requiredText(input.name, '数据源名称');
  const type = requiredText(input.type, '数据源类型').toLowerCase();
  if (!['mysql', 'oracle'].includes(type)) throw new Error(`不支持的数据源类型：${type}`);
  const host = requiredText(input.host, '数据源主机');
  const port = Number.parseInt(input.port, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`数据源端口无效：${input.port}`);
  }
  const username = requiredText(input.username, '数据源用户名');
  return {
    id,
    name,
    type,
    host,
    port,
    username,
    passwordEnc: normalizePasswordEnc(input.passwordEnc),
    database: String(input.database || '').trim(),
    serviceName: String(input.serviceName || '').trim(),
    connectString: String(input.connectString || '').trim(),
    connectionType:
      String(input.connectionType || '').trim() || (type === 'oracle' ? 'serviceName' : ''),
    schema: String(input.schema || '').trim(),
    readOnly: Boolean(input.readOnly),
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function canonicalEndpoint(input = {}) {
  const now = new Date().toISOString();
  const id = requiredText(input.id, '接口 id');
  const method = requiredText(input.method || 'GET', 'HTTP 方法').toUpperCase();
  const endpointPath = normalizeEndpointPath(input.path);
  const datasourceId = requiredText(input.datasourceId, '接口数据源');
  const engine = String(input.engine || 'sql').toLowerCase();
  if (!['sql', 'script'].includes(engine)) throw new Error(`接口引擎无效：${engine}`);
  const sql = engine === 'sql' ? requiredText(input.sql, '接口 SQL') : String(input.sql || '');
  const scriptCode = String(input.scriptCode ?? '');
  if (engine === 'script' && !scriptCode.trim()) throw new Error('脚本代码不能为空');
  const params = (Array.isArray(input.params) ? input.params : []).map((param) =>
    canonicalParam(param)
  );
  const maxPageSize = Number.parseInt(input.pagination?.maxPageSize, 10);
  return {
    id,
    name: String(input.name || `${method} ${endpointPath}`).trim(),
    method,
    path: endpointPath,
    datasourceId,
    sql,
    engine,
    scriptCode,
    allowHttp: Boolean(input.allowHttp),
    description: String(input.description || '').trim(),
    group: String(input.group || '').trim(),
    enabled: input.enabled !== false,
    allowRawSql: Boolean(input.allowRawSql),
    timeoutMs: Number.parseInt(input.timeoutMs, 10) || 0,
    params,
    pagination: {
      enabled: Boolean(input.pagination?.enabled),
      maxPageSize: Number.isInteger(maxPageSize)
        ? Math.min(5000, Math.max(1, maxPageSize))
        : 100
    },
    responseMode: input.responseMode === 'raw' ? 'raw' : 'wrap',
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now,
    callCount: Math.max(0, Number.parseInt(input.callCount, 10) || 0),
    lastCalledAt: input.lastCalledAt || null
  };
}

function canonicalParam(input = {}) {
  const name = requiredText(input.name, '参数名');
  const location = String(input.in || 'query').toLowerCase();
  const type = String(input.type || 'string').toLowerCase();
  if (!PARAM_LOCATIONS.has(location)) throw new Error(`参数来源无效：${location}`);
  if (!PARAM_TYPES.has(type)) throw new Error(`参数类型无效：${type}`);
  return {
    name,
    in: location,
    type,
    required: Boolean(input.required),
    defaultValue:
      input.defaultValue === undefined || input.defaultValue === null || input.defaultValue === ''
        ? null
        : String(input.defaultValue),
    description: String(input.description || '').trim()
  };
}

function canonicalScriptLibrary(input = {}) {
  const now = new Date().toISOString();
  const name = requiredText(input.name, '共享脚本名称');
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,59}$/.test(name)) {
    throw new Error('共享脚本名称必须以字母或下划线开头，且不超过 60 个字符');
  }
  const code = String(input.code ?? '');
  if (!code.trim()) throw new Error('共享脚本代码不能为空');
  return {
    name,
    description: String(input.description || '').trim(),
    code,
    enabled: input.enabled !== false,
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
}

function normalizeLegacyState(parsed) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('旧状态文件结构无效');
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    throw new Error(`不支持的旧状态文件版本：${parsed.version}`);
  }
  const datasourceInputs = parsed.datasources ?? [];
  const endpointInputs = parsed.endpoints ?? [];
  if (!Array.isArray(datasourceInputs) || !Array.isArray(endpointInputs)) {
    throw new Error('旧状态文件的 datasources 或 endpoints 不是数组');
  }

  const datasources = datasourceInputs.map(canonicalDatasource);
  const datasourceIds = new Map();
  const datasourceNames = new Map();
  for (const datasource of datasources) {
    if (datasourceIds.has(datasource.id)) {
      throw new Error(`旧状态文件包含重复数据源 id：${datasource.id}`);
    }
    datasourceIds.set(datasource.id, true);
    const normalizedName = datasource.name.toLowerCase();
    if (datasourceNames.has(normalizedName)) {
      throw new Error(`旧状态文件包含重复数据源名称：${datasource.name}`);
    }
    datasourceNames.set(normalizedName, true);
  }

  const endpoints = endpointInputs.map(canonicalEndpoint);
  const endpointIds = new Set();
  const pathSignatures = new Set();
  for (const endpoint of endpoints) {
    if (endpointIds.has(endpoint.id)) {
      throw new Error(`旧状态文件包含重复接口 id：${endpoint.id}`);
    }
    endpointIds.add(endpoint.id);
    if (!datasourceIds.has(endpoint.datasourceId)) {
      throw new Error(`接口 ${endpoint.id} 引用了不存在的数据源：${endpoint.datasourceId}`);
    }
    const signature = `${endpoint.method}:${endpointPathSignature(endpoint.path)}`;
    if (pathSignatures.has(signature)) {
      throw new Error(`旧状态文件包含冲突接口路径：${endpoint.method} ${endpoint.path}`);
    }
    pathSignatures.add(signature);
  }
  return { datasources, endpoints };
}

function datasourceParams(datasource) {
  return [
    datasource.id,
    datasource.name,
    datasource.type,
    datasource.host,
    datasource.port,
    datasource.username,
    serializePasswordEnc(datasource.passwordEnc),
    datasource.database,
    datasource.serviceName,
    datasource.connectString,
    datasource.connectionType,
    datasource.schema,
    datasource.readOnly ? 1 : 0,
    datasource.createdAt,
    datasource.updatedAt
  ];
}

function datasourceUpdateParams(datasource) {
  return [
    datasource.name,
    datasource.type,
    datasource.host,
    datasource.port,
    datasource.username,
    serializePasswordEnc(datasource.passwordEnc),
    datasource.database,
    datasource.serviceName,
    datasource.connectString,
    datasource.connectionType,
    datasource.schema,
    datasource.readOnly ? 1 : 0,
    datasource.createdAt,
    datasource.updatedAt,
    datasource.id
  ];
}

function endpointParams(endpoint) {
  return [
    endpoint.id,
    endpoint.name,
    endpoint.method,
    endpoint.path,
    endpointPathSignature(endpoint.path),
    endpoint.datasourceId,
    endpoint.sql,
    endpoint.engine,
    endpoint.scriptCode,
    endpoint.allowHttp ? 1 : 0,
    endpoint.description,
    endpoint.group,
    endpoint.enabled ? 1 : 0,
    endpoint.allowRawSql ? 1 : 0,
    endpoint.timeoutMs,
    endpoint.pagination.enabled ? 1 : 0,
    endpoint.pagination.maxPageSize,
    endpoint.responseMode,
    endpoint.createdAt,
    endpoint.updatedAt
  ];
}

function endpointUpdateParams(endpoint) {
  return [
    endpoint.name,
    endpoint.method,
    endpoint.path,
    endpointPathSignature(endpoint.path),
    endpoint.datasourceId,
    endpoint.sql,
    endpoint.engine,
    endpoint.scriptCode,
    endpoint.allowHttp ? 1 : 0,
    endpoint.description,
    endpoint.group,
    endpoint.enabled ? 1 : 0,
    endpoint.allowRawSql ? 1 : 0,
    endpoint.timeoutMs,
    endpoint.pagination.enabled ? 1 : 0,
    endpoint.pagination.maxPageSize,
    endpoint.responseMode,
    endpoint.createdAt,
    endpoint.updatedAt,
    endpoint.id
  ];
}

function datasourceFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    host: row.host,
    port: Number(row.port),
    username: row.username,
    passwordEnc: parsePasswordEnc(row.password_enc),
    database: row.database_name || '',
    serviceName: row.service_name || '',
    connectString: row.connect_string || '',
    connectionType: row.connection_type || '',
    schema: row.schema_name || '',
    readOnly: Boolean(row.read_only),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function endpointFromRow(row, params, stats) {
  return {
    id: row.id,
    name: row.name,
    method: row.method,
    path: row.path,
    datasourceId: row.datasource_id,
    sql: row.sql,
    engine: row.engine || 'sql',
    scriptCode: row.script_code || '',
    allowHttp: Boolean(row.allow_http),
    description: row.description || '',
    group: row.group_name || '',
    enabled: Boolean(row.enabled),
    allowRawSql: Boolean(row.allow_raw_sql),
    timeoutMs: Number(row.timeout_ms || 0),
    params,
    pagination: {
      enabled: Boolean(row.pagination_enabled),
      maxPageSize: Number(row.pagination_max_page_size || 100)
    },
    responseMode: row.response_mode || 'wrap',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    callCount: Number(stats?.call_count || 0),
    lastCalledAt: stats?.last_called_at || null
  };
}

function scriptLibraryFromRow(row) {
  return {
    name: row.name,
    description: row.description || '',
    code: row.code || '',
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function scriptLibraryParams(library) {
  return [
    library.name,
    library.description,
    library.code,
    library.enabled ? 1 : 0,
    library.createdAt,
    library.updatedAt
  ];
}

function scriptLibraryUpdateParams(library) {
  return [
    library.description,
    library.code,
    library.enabled ? 1 : 0,
    library.createdAt,
    library.updatedAt,
    library.name
  ];
}

function endpointSnapshot(endpoint) {
  const { callCount, lastCalledAt, ...snapshot } = endpoint;
  return snapshot;
}

function endpointVersionFromRow(row) {
  return {
    id: Number(row.id),
    endpointId: row.endpoint_id,
    version: Number(row.version),
    definition: JSON.parse(row.definition_json),
    createdAt: row.created_at
  };
}

function scriptLibraryVersionFromRow(row) {
  return {
    id: Number(row.id),
    name: row.name,
    version: Number(row.version),
    definition: JSON.parse(row.definition_json),
    createdAt: row.created_at
  };
}

function paramFromRow(row) {
  return {
    name: row.name,
    in: row.location,
    type: row.type,
    required: Boolean(row.required),
    defaultValue: row.default_value ?? null,
    description: row.description || ''
  };
}

function normalizePasswordEnc(value) {
  if (!value) return null;
  if (
    typeof value !== 'object' ||
    Number(value.v) !== 1 ||
    typeof value.iv !== 'string' ||
    typeof value.tag !== 'string' ||
    typeof value.data !== 'string'
  ) {
    throw new Error('数据源密码密文格式无效');
  }
  return {
    v: 1,
    iv: value.iv,
    tag: value.tag,
    data: value.data
  };
}

function serializePasswordEnc(value) {
  const payload = normalizePasswordEnc(value);
  if (!payload) return null;
  return `v${payload.v}:${payload.iv}:${payload.tag}:${payload.data}`;
}

function parsePasswordEnc(value) {
  if (!value) return null;
  const parts = String(value).split(':');
  if (parts.length !== 4) throw new Error('SQLite 中的数据源密码密文格式无效');
  const version = Number.parseInt(parts[0].replace(/^v/, ''), 10);
  return normalizePasswordEnc({
    v: version,
    iv: parts[1],
    tag: parts[2],
    data: parts[3]
  });
}

function requiredText(value, label) {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${label}不能为空`);
  return text;
}
