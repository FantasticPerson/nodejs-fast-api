import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatasourceService } from '../server/services/datasource-service.js';
import { SecretBox } from '../server/security/secret-box.js';
import { SqliteStore } from '../server/store.js';

test('datasource read-only setting is persisted and can be disabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-readonly-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const service = new DatasourceService({
    store,
    secretBox,
    driverManager: { async closePool() {} }
  });

  const created = await service.create({
    type: 'mysql',
    name: '只读数据源',
    host: '127.0.0.1',
    port: '3306',
    username: 'reader',
    password: 'secret',
    database: 'demo',
    readOnly: 'on'
  });
  assert.equal(created.readOnly, true);
  assert.equal(created.hasPassword, true);
  assert.equal(created.password, undefined);

  const updated = await service.update(created.id, {
    ...created,
    password: '',
    readOnly: false
  });
  assert.equal(updated.readOnly, false);
  assert.equal(store.findDatasource(created.id).readOnly, false);
  assert.equal(store.findDatasource(created.id).passwordEnc !== null, true);
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('Oracle draft tests use a temporary pool and preserve the SID connection mode', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-oracle-draft-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const calls = [];
  const service = new DatasourceService({
    store,
    secretBox,
    driverManager: {
      async test(datasource, options) {
        calls.push({ datasource, options });
        return { ok: true, type: 'oracle', currentUser: 'APP_USER' };
      },
      async closePool() {}
    }
  });

  await service.testDraft({
    type: 'oracle',
    name: 'Oracle SID',
    host: '10.0.0.10',
    port: '1521',
    username: 'app_user',
    password: 'secret',
    serviceName: 'ORCL',
    connectionType: 'sid'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].datasource.connectionType, 'sid');
  assert.deepEqual(calls[0].options, { ephemeral: true });
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('Oracle draft tests accept the service-name connection mode from the UI', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-oracle-service-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const secretBox = await SecretBox.create({ keyFile: path.join(dir, 'secret.bin') });
  const calls = [];
  const service = new DatasourceService({
    store,
    secretBox,
    driverManager: {
      async test(datasource, options) {
        calls.push({ datasource, options });
        return { ok: true, type: 'oracle', currentUser: 'APP_USER' };
      },
      async closePool() {}
    }
  });

  await service.testDraft({
    type: 'oracle',
    name: 'Oracle Service Name',
    host: '10.0.0.10',
    port: '1521',
    username: 'app_user',
    password: 'secret',
    serviceName: 'APPDB',
    connectionType: 'serviceName'
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].datasource.connectionType, 'serviceName');
  assert.deepEqual(calls[0].options, { ephemeral: true });
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});
