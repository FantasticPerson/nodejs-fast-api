import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { PluginRegistry } from '../server/plugins.js';

test('plugins load from files and expose namespaced actions', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'magic-plugins-'));
  await fs.writeFile(
    path.join(dir, 'pricing.js'),
    `export const actions = {
  calculate(input, context) {
    return { total: input.amount * 2, endpoint: context.endpoint.name };
  }
};
`
  );
  await fs.writeFile(path.join(dir, '_private.js'), 'throw new Error("must not load");');
  await fs.writeFile(path.join(dir, 'broken.js'), 'export const actions = {};');

  const registry = new PluginRegistry({ pluginsDir: dir });
  const metadata = await registry.load();
  assert.deepEqual(metadata.plugins, [{ name: 'pricing', actions: ['calculate'] }]);
  assert.equal(metadata.errors.length, 1);
  assert.match(metadata.errors[0].message, /不能为空/);

  const value = await registry.call(
    'pricing',
    'calculate',
    [{ amount: 10 }],
    { endpoint: { name: '订单接口' } }
  );
  assert.deepEqual(value, { total: 20, endpoint: '订单接口' });
  await fs.rm(dir, { recursive: true, force: true });
});
