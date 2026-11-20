import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { SqliteStore } from '../server/store.js';
import { EndpointService } from '../server/services/endpoint-service.js';
import { ScriptLibraryService } from '../server/services/script-library-service.js';

async function createStore() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'magic-script-version-'));
  const store = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const now = new Date().toISOString();
  store.insertDatasource({
    id: 'ds_1',
    name: 'Test DB',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    username: 'tester',
    database: 'test',
    createdAt: now,
    updatedAt: now
  });
  return { dir, store };
}

test('script endpoints persist, version every save and restore older code', async () => {
  const { dir, store } = await createStore();
  const service = new EndpointService({ store });
  const created = await service.create({
    name: 'Script endpoint',
    method: 'POST',
    path: '/script',
    datasourceId: 'ds_1',
    engine: 'script',
    scriptCode: 'return { version: 1 };',
    params: []
  });
  assert.equal(created.engine, 'script');
  assert.equal(created.scriptCode, 'return { version: 1 };');
  assert.equal(service.listVersions(created.id).length, 1);

  await service.update(created.id, {
    ...created,
    scriptCode: 'return { version: 2 };',
    allowHttp: true
  });
  const versions = service.listVersions(created.id);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 2);
  assert.equal(versions[0].definition.scriptCode, 'return { version: 2 };');

  await store.close();
  const reopened = await new SqliteStore(path.join(dir, 'state.sqlite')).init();
  const reopenedService = new EndpointService({ store: reopened });
  const endpoint = reopened.findEndpoint(created.id);
  assert.equal(endpoint.engine, 'script');
  assert.equal(endpoint.scriptCode, 'return { version: 2 };');
  assert.equal(reopenedService.listVersions(created.id).length, 2);

  const restored = await reopenedService.restoreVersion(created.id, 1);
  assert.equal(restored.scriptCode, 'return { version: 1 };');
  assert.equal(reopenedService.listVersions(created.id).length, 3);
  await reopened.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('shared script libraries version and restore their code', async () => {
  const { dir, store } = await createStore();
  const service = new ScriptLibraryService({ store });
  await service.create({
    name: 'helpers',
    description: 'test helpers',
    code: 'return { value() { return 1; } };'
  });
  const updated = await service.update('helpers', {
    name: 'helpers',
    description: 'updated',
    code: 'return { value() { return 2; } };'
  });
  assert.equal(updated.code, 'return { value() { return 2; } };');
  assert.equal(service.listVersions('helpers').length, 2);
  assert.equal(service.enabledLibraries().length, 1);

  const restored = await service.restoreVersion('helpers', 1);
  assert.equal(restored.code, 'return { value() { return 1; } };');
  assert.equal(service.listVersions('helpers').length, 3);
  await store.close();
  await fs.rm(dir, { recursive: true, force: true });
});
