import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatasourceService } from '../server/services/datasource-service.js';
import { SecretBox } from '../server/security/secret-box.js';
import { JsonStore } from '../server/store.js';

test('datasource read-only setting is persisted and can be disabled', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-magic-readonly-'));
  const store = await new JsonStore(path.join(dir, 'state.json')).init();
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
  await fs.rm(dir, { recursive: true, force: true });
});
