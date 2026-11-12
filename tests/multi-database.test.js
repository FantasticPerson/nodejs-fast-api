import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { JsonStore } from '../server/store.js';
import { SecretBox } from '../server/security/secret-box.js';
import { createApplication } from '../server/app.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function createRequest(url, remoteAddress = '127.0.0.1') {
  const stream = Readable.from([]);
  stream.method = 'GET';
  stream.url = url;
  stream.headers = {};
  stream.socket = { remoteAddress };
  return stream;
}

async function invoke(handler, url, remoteAddress = '127.0.0.1') {
  const req = createRequest(url, remoteAddress);
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

class DualDriverManager {
  constructor() {
    this.calls = [];
    this.pools = new Map();
  }

  async driverStatus() {
    return { mysql: true, oracle: true };
  }

  async execute(datasource, sql, values) {
    this.calls.push({ datasource, sql, values });
    return {
      rows: [{ dialect: datasource.type, id: values[0] }],
      affectedRows: 0,
      insertId: null
    };
  }

  async closePool() {}

  async dispose() {}
}

test('MySQL and Oracle datasources coexist and serve endpoints at the same time', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-dual-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const driverManager = new DualDriverManager();
  const config = {
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    managementPath: '/magic/api',
    openapiPath: '/openapi',
    adminToken: '',
    openapiToken: '',
    corsOrigin: '*',
    maxBodyBytes: 2 * 1024 * 1024,
    version: '1.0.0'
  };
  const app = createApplication({ config, store, secretBox, driverManager });
  const now = new Date().toISOString();

  await store.mutate((state) => {
    state.datasources.push(
      {
        id: 'ds_mysql',
        name: 'MySQL Demo',
        type: 'mysql',
        host: '127.0.0.1',
        port: 3306,
        username: 'mysql_user',
        passwordEnc: secretBox.encrypt('mysql_password'),
        database: 'demo',
        serviceName: '',
        connectString: '',
        schema: '',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'ds_oracle',
        name: 'Oracle Demo',
        type: 'oracle',
        host: '127.0.0.1',
        port: 1521,
        username: 'oracle_user',
        passwordEnc: secretBox.encrypt('oracle_password'),
        database: '',
        serviceName: 'ORCL',
        connectString: '',
        schema: 'REPORT',
        createdAt: now,
        updatedAt: now
      }
    );
    state.endpoints.push(
      {
        id: 'api_mysql',
        name: 'MySQL 查询',
        method: 'GET',
        path: '/mysql/:id',
        datasourceId: 'ds_mysql',
        sql: 'SELECT id FROM users WHERE id = #{id}',
        description: '',
        group: '',
        enabled: true,
        allowRawSql: false,
        params: [{ name: 'id', in: 'path', type: 'number', required: true, defaultValue: null, description: '' }],
        pagination: { enabled: false, maxPageSize: 100 },
        responseMode: 'raw',
        createdAt: now,
        updatedAt: now,
        callCount: 0,
        lastCalledAt: null
      },
      {
        id: 'api_oracle',
        name: 'Oracle 查询',
        method: 'GET',
        path: '/oracle/:id',
        datasourceId: 'ds_oracle',
        sql: 'SELECT "ID" FROM "REPORT"."USERS" WHERE "ID" = #{id}',
        description: '',
        group: '',
        enabled: true,
        allowRawSql: false,
        params: [{ name: 'id', in: 'path', type: 'number', required: true, defaultValue: null, description: '' }],
        pagination: { enabled: false, maxPageSize: 100 },
        responseMode: 'raw',
        createdAt: now,
        updatedAt: now,
        callCount: 0,
        lastCalledAt: null
      }
    );
  });

  const bootstrap = await invoke(app.handler, '/magic/api/bootstrap');
  const bootstrapPayload = JSON.parse(bootstrap.body);
  assert.equal(bootstrapPayload.data.datasources.length, 2);
  assert.deepEqual(
    bootstrapPayload.data.datasources.map((item) => item.type),
    ['mysql', 'oracle']
  );
  assert.deepEqual(bootstrapPayload.data.config.drivers, { mysql: true, oracle: true });

  const mysqlResponse = await invoke(app.handler, '/openapi/mysql/7');
  const oracleResponse = await invoke(app.handler, '/openapi/oracle/8');
  assert.equal(mysqlResponse.statusCode, 200);
  assert.equal(oracleResponse.statusCode, 200);
  assert.deepEqual(JSON.parse(mysqlResponse.body), [{ dialect: 'mysql', id: 7 }]);
  assert.deepEqual(JSON.parse(oracleResponse.body), [{ dialect: 'oracle', id: 8 }]);

  assert.equal(driverManager.calls.length, 2);
  assert.equal(driverManager.calls[0].datasource.type, 'mysql');
  assert.equal(driverManager.calls[1].datasource.type, 'oracle');
  assert.match(driverManager.calls[0].sql, /id = \?/);
  assert.match(driverManager.calls[1].sql, /"ID" = :p0/);

  await store.queue;
  await fs.rm(dir, { recursive: true, force: true });
});
