import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../server/store.js';
import { SecretBox } from '../server/security/secret-box.js';

test('SQLite store persists datasource, endpoint, params and call stats across reopen', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-sqlite-'));
  const dbFile = path.join(dir, 'state.sqlite');
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const store = await new SqliteStore(dbFile).init();
  const now = new Date().toISOString();

  await store.insertDatasource({
    id: 'ds_1',
    name: 'SQLite Demo',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'reader',
    passwordEnc: secretBox.encrypt('secret'),
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    readOnly: true,
    createdAt: now,
    updatedAt: now
  });
  await store.insertEndpoints([
    {
      id: 'api_1',
      name: '列表',
      method: 'GET',
      path: '/users/:id',
      datasourceId: 'ds_1',
      sql: 'SELECT id, name FROM users WHERE id = #{id}',
      description: '查询用户',
      group: '用户',
      enabled: true,
      allowRawSql: false,
      timeoutMs: 1500,
      params: [
        {
          name: 'id',
          in: 'path',
          type: 'number',
          required: true,
          defaultValue: null,
          description: '用户 ID'
        }
      ],
      pagination: { enabled: true, maxPageSize: 200 },
      responseMode: 'wrap',
      createdAt: now,
      updatedAt: now,
      callCount: 7,
      lastCalledAt: '2026-11-18T00:00:00.000Z'
    }
  ]);

  assert.equal(store.recordCall('api_1', '2026-11-19T00:00:00.000Z'), true);
  assert.equal(store.flushStats(), 1);
  await store.close();

  const reopened = await new SqliteStore(dbFile).init();
  const datasource = reopened.findDatasource('ds_1');
  const endpoint = reopened.findEndpoint('api_1');
  assert.equal(datasource.readOnly, true);
  assert.equal(secretBox.decrypt(datasource.passwordEnc), 'secret');
  assert.equal(endpoint.timeoutMs, 1500);
  assert.equal(endpoint.group, '用户');
  assert.equal(endpoint.params[0].name, 'id');
  assert.equal(endpoint.params[0].required, true);
  assert.equal(endpoint.pagination.maxPageSize, 200);
  assert.equal(endpoint.callCount, 8);
  assert.equal(endpoint.lastCalledAt, '2026-11-19T00:00:00.000Z');
  await reopened.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('legacy state.json is imported once and kept as the recovery source', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-migrate-'));
  const dbFile = path.join(dir, 'state.sqlite');
  const legacyFile = path.join(dir, 'state.json');
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const now = new Date().toISOString();
  const legacy = {
    version: 1,
    datasources: [
      {
        id: 'ds_legacy',
        name: '旧数据源',
        type: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'reader',
        passwordEnc: secretBox.encrypt('legacy-secret'),
        database: 'demo',
        serviceName: '',
        connectString: '',
        schema: '',
        createdAt: now,
        updatedAt: now
      }
    ],
    endpoints: [
      {
        id: 'api_legacy',
        name: '旧接口',
        method: 'GET',
        path: '/legacy/:id',
        datasourceId: 'ds_legacy',
        sql: 'SELECT id FROM users WHERE id = #{id}',
        description: '',
        group: '',
        enabled: true,
        allowRawSql: false,
        timeoutMs: 0,
        params: [
          {
            name: 'id',
            in: 'path',
            type: 'number',
            required: true,
            defaultValue: null,
            description: ''
          }
        ],
        pagination: { enabled: false, maxPageSize: 100 },
        responseMode: 'raw',
        createdAt: now,
        updatedAt: now,
        callCount: 3,
        lastCalledAt: '2026-11-12T00:00:00.000Z'
      }
    ]
  };
  const legacyContent = `${JSON.stringify(legacy, null, 2)}\n`;
  await fs.writeFile(legacyFile, legacyContent);

  const store = await new SqliteStore(dbFile, { legacyStateFile: legacyFile }).init();
  assert.equal(store.listDatasources().length, 1);
  assert.equal(store.listEndpoints().length, 1);
  assert.equal(store.findEndpoint('api_legacy').callCount, 3);
  assert.equal(secretBox.decrypt(store.findDatasource('ds_legacy').passwordEnc), 'legacy-secret');
  assert.equal(await fs.readFile(legacyFile, 'utf8'), legacyContent);
  await store.close();

  const reopened = await new SqliteStore(dbFile, { legacyStateFile: legacyFile }).init();
  assert.equal(reopened.listDatasources().length, 1);
  assert.equal(reopened.listEndpoints().length, 1);
  await reopened.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('failed legacy migration is rolled back and can be retried after repair', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-migrate-retry-'));
  const dbFile = path.join(dir, 'state.sqlite');
  const legacyFile = path.join(dir, 'state.json');
  const invalid = {
    version: 1,
    datasources: [],
    endpoints: [
      {
        id: 'api_broken',
        method: 'GET',
        path: '/broken',
        datasourceId: 'ds_missing',
        sql: 'SELECT 1',
        params: []
      }
    ]
  };
  await fs.writeFile(legacyFile, `${JSON.stringify(invalid, null, 2)}\n`);
  await assert.rejects(
    new SqliteStore(dbFile, { legacyStateFile: legacyFile }).init(),
    /引用了不存在的数据源/
  );

  invalid.datasources.push({
    id: 'ds_missing',
    name: '修复后的数据源',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'reader',
    passwordEnc: null,
    database: 'demo'
  });
  await fs.writeFile(legacyFile, `${JSON.stringify(invalid, null, 2)}\n`);

  const store = await new SqliteStore(dbFile, { legacyStateFile: legacyFile }).init();
  assert.equal(store.listDatasources().length, 1);
  assert.equal(store.listEndpoints().length, 1);
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});
