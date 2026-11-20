import assert from 'node:assert/strict';
import test from 'node:test';
import { ScriptService } from '../server/script/script-service.js';

function createLibraryService(code = '') {
  return {
    enabledLibraries() {
      return code
        ? [{ name: 'helper', code }]
        : [];
    }
  };
}

function createPluginRegistry(invoke = null) {
  return {
    metadata() {
      return {
        plugins: invoke ? [{ name: 'demo', actions: ['run'] }] : [],
        errors: []
      };
    },
    async ensureLoaded() {
      return this.metadata();
    },
    async call(name, action, args, context) {
      return invoke(name, action, args, context);
    }
  };
}

function endpoint(scriptCode, timeoutMs = 5000) {
  return {
    id: 'api_script',
    name: '脚本接口',
    engine: 'script',
    scriptCode,
    timeoutMs,
    params: [
      { name: 'id', in: 'query', type: 'number', required: true, defaultValue: null }
    ]
  };
}

function sources(id = '7') {
  return { query: { id }, body: {}, path: {}, headers: {} };
}

test('script worker exposes params, shared libraries, database queries and transactions', async () => {
  const calls = [];
  const commits = [];
  const driverManager = {
    async execute(datasource, sql, values) {
      calls.push({ type: 'query', sql, values });
      return { rows: [{ id: values[0], name: 'Ada' }], affectedRows: 0, insertId: null };
    },
    async openTransaction() {
      return {
        async execute(sql, values) {
          calls.push({ type: 'transaction', sql, values });
          return { rows: [], affectedRows: 1, insertId: null };
        },
        async commit() {
          commits.push('commit');
        },
        async rollback() {},
        async close() {}
      };
    }
  };
  const service = new ScriptService({
    driverManager,
    scriptLibraryService: createLibraryService(
      'return { label(value) { return `user:${value}`; } };'
    ),
    pluginRegistry: createPluginRegistry(async (name, action, args) => {
      assert.equal(name, 'demo');
      assert.equal(action, 'run');
      return { input: args[0], label: 'plugin' };
    }),
    scriptTimeoutMs: 5000
  });

  const outcome = await service.execute({
    endpoint: endpoint(`
const row = await db.queryOne('SELECT id, name FROM users WHERE id = #{id}', { id: ctx.params.id });
await db.transaction(async (tx) => {
  await tx.execute('UPDATE users SET name = #{name} WHERE id = #{id}', { name: ctx.libs.helper.label('Ada'), id: ctx.params.id });
});
const plugin = await plugins.demo.run({ id: ctx.params.id });
return { row, plugin };
`),
    datasource: { id: 'ds', type: 'mysql', name: 'test', readOnly: false },
    sources: sources()
  });

  assert.deepEqual(outcome.value.row, { id: 7, name: 'Ada' });
  assert.deepEqual(outcome.value.plugin, { input: { id: 7 }, label: 'plugin' });
  assert.equal(calls[0].type, 'query');
  assert.match(calls[0].sql, /SELECT id, name FROM users/);
  assert.deepEqual(calls[0].values, [7]);
  assert.equal(calls[1].type, 'transaction');
  assert.deepEqual(calls[1].values, ['user:Ada', 7]);
  assert.deepEqual(commits, ['commit']);
});

test('script timeout terminates the worker and returns SCRIPT_TIMEOUT', async () => {
  const service = new ScriptService({
    driverManager: {},
    scriptLibraryService: createLibraryService(),
    pluginRegistry: createPluginRegistry(),
    scriptTimeoutMs: 1000
  });
  await assert.rejects(
    service.execute({
      endpoint: endpoint('while (true) {}', 200),
      datasource: { id: 'ds', type: 'mysql', name: 'test', readOnly: true },
      sources: sources()
    }),
    (error) => error.code === 'SCRIPT_TIMEOUT' && error.status === 504
  );
});

test('HTTP access requires an endpoint switch and an allowlist match', async () => {
  const service = new ScriptService({
    driverManager: {},
    scriptLibraryService: createLibraryService(),
    pluginRegistry: createPluginRegistry(),
    scriptHttpAllowlist: ['api.example.com'],
    scriptHttpMaxResponseBytes: 1024
  });
  await assert.rejects(
    service.handleHttp({
      endpoint: { allowHttp: false },
      url: 'https://api.example.com/v1',
      options: {},
      deadline: Date.now() + 1000
    }),
    (error) => error.code === 'SCRIPT_HTTP_DISABLED'
  );
  await assert.rejects(
    service.handleHttp({
      endpoint: { allowHttp: true },
      url: 'https://other.example.com/v1',
      options: {},
      deadline: Date.now() + 1000
    }),
    (error) => error.code === 'SCRIPT_HTTP_HOST_DENIED'
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  try {
    const result = await service.handleHttp({
      endpoint: { allowHttp: true },
      url: 'https://api.example.com/v1',
      options: {},
      deadline: Date.now() + 1000
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, { ok: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
