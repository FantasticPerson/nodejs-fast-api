import { parentPort, workerData } from 'node:worker_threads';
import util from 'node:util';
import vm from 'node:vm';

const pending = new Map();
const logs = [];
let sequence = 0;

parentPort.on('message', (message) => {
  const resolver = pending.get(message.id);
  if (!resolver) return;
  pending.delete(message.id);
  if (message.ok) resolver.resolve(message.value);
  else resolver.reject(new Error(message.error || '脚本调用失败'));
});

function rpc(type, payload = {}) {
  sequence += 1;
  const id = sequence;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    parentPort.postMessage({ type, id, ...payload });
  });
}

function appendLog(level, args) {
  if (logs.length >= 100) return;
  logs.push({
    level,
    message: util.format(...args).slice(0, 1000)
  });
}

const db = {
  query(sql, params = {}) {
    return rpc('db.query', { sql, params });
  },
  async queryOne(sql, params = {}) {
    const rows = await rpc('db.queryOne', { sql, params });
    return Array.isArray(rows) ? rows[0] ?? null : null;
  },
  execute(sql, params = {}) {
    return rpc('db.execute', { sql, params });
  },
  async transaction(operation) {
    if (typeof operation !== 'function') throw new Error('db.transaction 需要传入函数');
    const txId = await rpc('db.begin');
    const tx = {
      query: (sql, params = {}) => rpc('db.transactionQuery', { txId, sql, params }),
      queryOne: async (sql, params = {}) => {
        const rows = await rpc('db.transactionQuery', { txId, sql, params });
        return Array.isArray(rows) ? rows[0] ?? null : null;
      },
      execute: (sql, params = {}) => rpc('db.transactionExecute', { txId, sql, params })
    };
    try {
      const result = await operation(tx);
      await rpc('db.commit', { txId });
      return result;
    } catch (error) {
      await rpc('db.rollback', { txId }).catch(() => {});
      throw error;
    }
  }
};

const http = {
  fetch(url, options = {}) {
    return rpc('http.fetch', { url, options });
  }
};

const pluginMetadata = workerData.plugins || [];
const plugins = {};
for (const plugin of pluginMetadata) {
  plugins[plugin.name] = {};
  for (const action of plugin.actions) {
    plugins[plugin.name][action] = (...args) =>
      rpc('plugin.call', { name: plugin.name, action, args });
  }
}

const logger = {
  debug: (...args) => appendLog('debug', args),
  info: (...args) => appendLog('info', args),
  warn: (...args) => appendLog('warn', args),
  error: (...args) => appendLog('error', args)
};

const libs = {};
const request = workerData.request || {};
const params = workerData.params || {};
const ctx = {
  params,
  request,
  endpoint: workerData.endpoint || {},
  db,
  http,
  plugins,
  libs,
  logger,
  console: logger
};
const sandbox = vm.createContext({
  ctx,
  params,
  db,
  http,
  plugins,
  libs,
  logger,
  console: logger,
  URL,
  URLSearchParams,
  setTimeout,
  clearTimeout
});

const filename = `endpoint-${workerData.endpoint?.id || 'script'}.js`;

async function evaluate(source, name) {
  const script = new vm.Script(`(async () => {\n${source}\n})()`, {
    filename: name,
    displayErrors: true
  });
  return await script.runInContext(sandbox);
}

async function run() {
  for (const library of workerData.libs || []) {
    const value = await evaluate(library.code, `lib-${library.name}.js`);
    if (!value || typeof value !== 'object') {
      throw new Error(`共享脚本 ${library.name} 必须返回对象`);
    }
    libs[library.name] = value;
  }
  const value = await evaluate(workerData.source, filename);
  parentPort.postMessage({ type: 'result', value, logs });
}

run().catch((error) => {
  parentPort.postMessage({
    type: 'error',
    error: String(error?.message || error).slice(0, 500),
    logs
  });
});
