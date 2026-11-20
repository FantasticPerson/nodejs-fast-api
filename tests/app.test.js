import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { SqliteStore } from '../server/store.js';
import { SecretBox } from '../server/security/secret-box.js';
import { DriverManager } from '../server/driver-manager.js';
import { createApplication } from '../server/app.js';
import { queryTimeoutError } from '../server/timeout.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function createHarness(adminToken = '') {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-app-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const config = {
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    managementPath: '/magic/api',
    openapiPath: '/openapi',
    adminToken,
    openapiToken: '',
    corsOrigin: '*',
    queryTimeoutMs: 30000,
    maxBodyBytes: 2 * 1024 * 1024,
    version: '1.0.0'
  };
  const app = createApplication({ config, store, secretBox, driverManager: new DriverManager() });
  return { dir, store, secretBox, config, app };
}

function createRequest({ method = 'GET', url = '/', body, remoteAddress = '127.0.0.1', headers = {} } = {}) {
  const stream = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(body)]);
  stream.method = method;
  stream.url = url;
  stream.headers = {
    ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    ...headers
  };
  stream.socket = { remoteAddress };
  return stream;
}

async function invoke(handler, options) {
  const req = createRequest(options);
  const res = {
    statusCode: 200,
    headersSent: false,
    headers: {},
    body: '',
    setHeader(key, value) {
      this.headers[key.toLowerCase()] = String(value);
    },
    end(chunk = '') {
      this.body = String(chunk);
      this.headersSent = true;
    }
  };
  await handler(req, res);
  return res;
}

test('health endpoint is public and reports driver availability', async () => {
  const harness = await createHarness();
  const res = await invoke(harness.app.handler, { url: '/magic/api/health' });
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'node-magic-api');
  assert.equal(typeof payload.drivers.mysql, 'boolean');
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('management API is limited to loopback when ADMIN_TOKEN is empty', async () => {
  const harness = await createHarness();
  const res = await invoke(harness.app.handler, {
    url: '/magic/api/bootstrap',
    remoteAddress: '192.168.1.20'
  });
  assert.equal(res.statusCode, 401);
  const payload = JSON.parse(res.body);
  assert.equal(payload.error.code, 'ADMIN_AUTH_REQUIRED');
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('ADMIN_TOKEN protects the management API', async () => {
  const harness = await createHarness('test-token');
  const unauthorized = await invoke(harness.app.handler, { url: '/magic/api/bootstrap' });
  assert.equal(unauthorized.statusCode, 401);
  const authorized = await invoke(harness.app.handler, {
    url: '/magic/api/bootstrap',
    headers: { 'x-admin-token': 'test-token' }
  });
  assert.equal(authorized.statusCode, 200);
  const payload = JSON.parse(authorized.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.data.config.adminTokenRequired, true);
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('console render validates templates without touching a real database', async () => {
  const harness = await createHarness();
  const now = new Date().toISOString();
  await harness.store.insertDatasource({
    id: 'ds_test',
    name: 'test',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'user',
    passwordEnc: harness.secretBox.encrypt('secret'),
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    createdAt: now,
    updatedAt: now
  });
  const body = JSON.stringify({
    datasourceId: 'ds_test',
    sql: 'SELECT id FROM users WHERE id = #{id}',
    params: [{ name: 'id', in: 'query', type: 'number' }],
    values: { id: 1 }
  });
  const res = await invoke(harness.app.handler, {
    method: 'POST',
    url: '/magic/api/console/render',
    body
  });
  assert.equal(res.statusCode, 200);
  const payload = JSON.parse(res.body);
  assert.equal(payload.ok, true);
  assert.match(payload.data.sql, /WHERE id = \?/);
  assert.deepEqual(payload.data.values, [1]);
  assert.equal(payload.data.dialect, 'mysql');
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('script endpoints execute through the OpenAPI runtime and console', async () => {
  const harness = await createHarness();
  const now = new Date().toISOString();
  await harness.store.insertDatasource({
    id: 'ds_script',
    name: 'script-db',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'user',
    passwordEnc: harness.secretBox.encrypt('secret'),
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    createdAt: now,
    updatedAt: now
  });
  harness.store.insertEndpoints([
    {
      id: 'api_script',
      name: 'Script endpoint',
      method: 'GET',
      path: '/script',
      datasourceId: 'ds_script',
      sql: '',
      engine: 'script',
      scriptCode: 'return { id: ctx.params.id, source: "runtime" };',
      description: '',
      group: '',
      enabled: true,
      allowRawSql: false,
      allowHttp: false,
      timeoutMs: 5000,
      params: [{ name: 'id', in: 'query', type: 'number', required: true }],
      pagination: { enabled: false, maxPageSize: 100 },
      responseMode: 'wrap',
      createdAt: now,
      updatedAt: now
    }
  ]);

  const runtime = await invoke(harness.app.handler, { url: '/openapi/script?id=9' });
  assert.equal(runtime.statusCode, 200);
  assert.deepEqual(JSON.parse(runtime.body), {
    code: 0,
    message: 'ok',
    data: { id: 9, source: 'runtime' }
  });

  const consoleRun = await invoke(harness.app.handler, {
    method: 'POST',
    url: '/magic/api/console/run',
    body: JSON.stringify({
      datasourceId: 'ds_script',
      engine: 'script',
      scriptCode: 'return { id: ctx.params.id };',
      params: [{ name: 'id', in: 'query', type: 'number' }],
      values: { id: 11 },
      timeoutMs: 5000
    })
  });
  assert.equal(consoleRun.statusCode, 200);
  assert.deepEqual(JSON.parse(consoleRun.body).data, {
    result: { id: 11 },
    logs: []
  });
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('static UI and OpenAPI document are served', async () => {
  const harness = await createHarness();
  const page = await invoke(harness.app.handler, { url: '/' });
  assert.equal(page.statusCode, 200);
  assert.match(page.body, /Node Magic API Studio/);
  assert.equal(page.headers['cache-control'], 'no-store');
  const stylesheet = await invoke(harness.app.handler, { url: '/styles.css' });
  assert.equal(stylesheet.statusCode, 200);
  assert.equal(stylesheet.headers['cache-control'], 'no-store');
  const spec = await invoke(harness.app.handler, { url: '/magic/api/openapi.json' });
  assert.equal(spec.statusCode, 200);
  const document = JSON.parse(spec.body);
  assert.equal(document.openapi, '3.0.3');
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('generated APIs expose DB_QUERY_TIMEOUT with HTTP 504', async () => {
  const harness = await createHarness();
  const now = new Date().toISOString();
  await harness.store.insertDatasource({
    id: 'ds_timeout',
    name: 'timeout',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'user',
    passwordEnc: harness.secretBox.encrypt('secret'),
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    createdAt: now,
    updatedAt: now
  });
  await harness.store.insertEndpoints([
    {
      id: 'api_timeout',
      name: '超时接口',
      method: 'GET',
      path: '/slow',
      datasourceId: 'ds_timeout',
      sql: 'SELECT 1',
      description: '',
      group: '',
      enabled: true,
      allowRawSql: false,
      timeoutMs: 50,
      params: [],
      pagination: { enabled: false, maxPageSize: 100 },
      responseMode: 'wrap',
      createdAt: now,
      updatedAt: now,
      callCount: 0,
      lastCalledAt: null
    }
  ]);
  harness.app.services.driverManager.execute = async () => {
    throw queryTimeoutError(50);
  };

  const res = await invoke(harness.app.handler, { url: '/openapi/slow' });
  assert.equal(res.statusCode, 504);
  const payload = JSON.parse(res.body);
  assert.equal(payload.errorCode, 'DB_QUERY_TIMEOUT');
  assert.equal(payload.message, '数据库查询超时（50 ms）');
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});

test('read-only datasource rejects generated write APIs with HTTP 403', async () => {
  const harness = await createHarness();
  const now = new Date().toISOString();
  await harness.store.insertDatasource({
    id: 'ds_readonly',
    name: '只读库',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'reader',
    passwordEnc: harness.secretBox.encrypt('secret'),
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    readOnly: true,
    createdAt: now,
    updatedAt: now
  });
  await harness.store.insertEndpoints([
    {
      id: 'api_readonly_write',
      name: '禁止写入',
      method: 'POST',
      path: '/users',
      datasourceId: 'ds_readonly',
      sql: 'DELETE FROM users WHERE id = #{id}',
      description: '',
      group: '',
      enabled: true,
      allowRawSql: false,
      timeoutMs: 0,
      params: [{ name: 'id', in: 'body', type: 'number', required: true, defaultValue: null, description: '' }],
      pagination: { enabled: false, maxPageSize: 100 },
      responseMode: 'wrap',
      createdAt: now,
      updatedAt: now,
      callCount: 0,
      lastCalledAt: null
    }
  ]);

  const res = await invoke(harness.app.handler, {
    method: 'POST',
    url: '/openapi/users',
    body: JSON.stringify({ id: 1 })
  });
  assert.equal(res.statusCode, 403);
  const payload = JSON.parse(res.body);
  assert.equal(payload.errorCode, 'DATASOURCE_READ_ONLY');
  assert.match(payload.message, /只读模式/);
  await harness.store.close();
  await fs.rm(harness.dir, { recursive: true, force: true });
});
