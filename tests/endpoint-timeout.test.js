import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SqliteStore } from '../server/store.js';
import { EndpointService } from '../server/services/endpoint-service.js';

test('endpoint timeout is persisted and invalid values are rejected', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-endpoint-timeout-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const now = new Date().toISOString();
  await store.insertDatasource({
    id: 'ds_test',
    name: 'test',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'user',
    passwordEnc: null,
    database: 'demo',
    serviceName: '',
    connectString: '',
    schema: '',
    createdAt: now,
    updatedAt: now
  });
  const service = new EndpointService({ store });

  const created = await service.create({
    method: 'GET',
    path: '/timeout',
    datasourceId: 'ds_test',
    sql: 'SELECT 1',
    timeoutMs: 1500
  });
  assert.equal(created.timeoutMs, 1500);

  await assert.rejects(
    service.create({
      method: 'GET',
      path: '/invalid-timeout',
      datasourceId: 'ds_test',
      sql: 'SELECT 1',
      timeoutMs: -1
    }),
    /接口超时必须是 0 到 600000 的整数毫秒/
  );
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});
