import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { SqliteStore } from '../server/store.js';

test('existing schema v2 is upgraded without losing SQL endpoints', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'magic-schema-v2-'));
  const file = path.join(dir, 'state.sqlite');
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE datasources (
      id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      type TEXT NOT NULL, host TEXT NOT NULL, port INTEGER NOT NULL,
      username TEXT NOT NULL, password_enc TEXT, database_name TEXT NOT NULL DEFAULT '',
      service_name TEXT NOT NULL DEFAULT '', connect_string TEXT NOT NULL DEFAULT '',
      connection_type TEXT NOT NULL DEFAULT '', schema_name TEXT NOT NULL DEFAULT '',
      read_only INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE endpoints (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL,
      path_signature TEXT NOT NULL, datasource_id TEXT NOT NULL REFERENCES datasources(id),
      sql TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', group_name TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, allow_raw_sql INTEGER NOT NULL DEFAULT 0,
      timeout_ms INTEGER NOT NULL DEFAULT 0, pagination_enabled INTEGER NOT NULL DEFAULT 0,
      pagination_max_page_size INTEGER NOT NULL DEFAULT 100,
      response_mode TEXT NOT NULL DEFAULT 'wrap', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE endpoint_params (
      id INTEGER PRIMARY KEY AUTOINCREMENT, endpoint_id TEXT NOT NULL REFERENCES endpoints(id),
      position INTEGER NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL, type TEXT NOT NULL,
      required INTEGER NOT NULL DEFAULT 0, default_value TEXT, description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE endpoint_stats (
      endpoint_id TEXT PRIMARY KEY, call_count INTEGER NOT NULL DEFAULT 0, last_called_at TEXT
    );
    INSERT INTO meta VALUES ('initialized', '1');
    INSERT INTO meta VALUES ('schema_version', '2');
    INSERT INTO datasources VALUES (
      'ds_old', 'Old DB', 'mysql', '127.0.0.1', 3306, 'tester', NULL, 'test',
      '', '', '', '', 0, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    );
    INSERT INTO endpoints VALUES (
      'api_old', 'Old query', 'GET', '/old', '/old', 'ds_old',
      'SELECT 1 AS ok', '', '', 1, 0, 0, 0, 100, 'wrap',
      '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
    );
  `);
  db.close();

  const store = await new SqliteStore(file).init();
  const endpoint = store.findEndpoint('api_old');
  assert.equal(endpoint.engine, 'sql');
  assert.equal(endpoint.scriptCode, '');
  assert.equal(endpoint.allowHttp, false);
  assert.equal(store.listEndpointVersions('api_old').length, 1);
  assert.equal(store.getMeta('schema_version'), '3');
  const libraryTable = store.db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'script_libraries'")
    .get();
  assert.equal(libraryTable.name, 'script_libraries');
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});
