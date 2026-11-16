import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOracleConnectString,
  DriverManager,
  normalizeOracleRows,
  unwrapModuleDefault
} from '../server/driver-manager.js';

test('Oracle connect strings use service-name or SID syntax', () => {
  const base = { host: '10.0.0.10', port: 1521, serviceName: 'ORCL' };

  assert.equal(buildOracleConnectString(base), '10.0.0.10:1521/ORCL');
  assert.equal(
    buildOracleConnectString({ ...base, connectionType: 'sid' }),
    '10.0.0.10:1521:ORCL'
  );
  assert.equal(
    buildOracleConnectString({ ...base, connectString: 'db.example.com:1521/PDB1' }),
    'db.example.com:1521/PDB1'
  );
});

test('Oracle pools are cached only after authentication succeeds', async () => {
  const manager = new DriverManager();
  let attempts = 0;
  let closed = 0;
  manager.createPoolEntry = async () => {
    attempts += 1;
    const currentAttempt = attempts;
    return {
      type: 'oracle',
      pool: {
        async getConnection() {
          if (currentAttempt === 1) throw new Error('ORA-01017: invalid username/password');
          return { close: async () => {} };
        },
        async close() {
          closed += 1;
        }
      },
      oracledb: { OUT_FORMAT_OBJECT: 4002 }
    };
  };
  const datasource = { id: 'ds_oracle_retry', type: 'oracle' };

  await assert.rejects(manager.getPool(datasource), /ORA-01017/);
  assert.equal(manager.pools.has(datasource.id), false);
  assert.equal(closed, 1);

  const entry = await manager.getPool(datasource);
  assert.equal(attempts, 2);
  assert.equal(manager.pools.get(datasource.id), entry);
});

test('Oracle CLOB values are read in chunks and concatenated', async () => {
  const oracledb = { CLOB: { name: 'CLOB' }, NCLOB: { name: 'NCLOB' } };
  const content = `start-${'中'.repeat(40000)}-😀-end`;
  const characters = Array.from(content);
  let reads = 0;
  let destroyed = false;
  const lob = {
    type: oracledb.CLOB,
    async getData(offset, amount) {
      reads += 1;
      return characters.slice(offset - 1, offset - 1 + amount).join('');
    },
    destroy() {
      destroyed = true;
    }
  };

  const rows = await normalizeOracleRows([{ text: lob, nested: { text: lob } }], oracledb);

  assert.equal(rows[0].text, content);
  assert.equal(rows[0].nested.text, content);
  assert.ok(reads > 1);
  assert.equal(destroyed, true);
});

test('ephemeral connection tests close their temporary pool', async () => {
  const manager = new DriverManager();
  let testedId = null;
  let closedId = null;
  manager.execute = async (datasource) => {
    testedId = datasource.id;
    return { rows: [{ CURRENT_USER: 'APP_USER' }] };
  };
  manager.closePool = async (datasourceId) => {
    closedId = datasourceId;
  };

  const result = await manager.test({ type: 'oracle' }, { ephemeral: true });

  assert.match(testedId, /^oracle_test_/);
  assert.equal(closedId, testedId);
  assert.equal(result.currentUser, 'APP_USER');
});

test('CommonJS driver modules are unwrapped from the ESM namespace', () => {
  const namespace = {
    getConnection() {},
    default: { thin: true, initOracleClient() {} }
  };

  const driver = unwrapModuleDefault(namespace);
  assert.equal(typeof driver.initOracleClient, 'function');
  assert.equal(driver.thin, true);
  assert.equal(unwrapModuleDefault(driver), driver);
});

test('Oracle Thick mode initializes once with the configured client directory', () => {
  const manager = new DriverManager({ oracleClientLibDir: '/opt/oracle/instantclient_19' });
  const calls = [];
  const oracledb = {
    initOracleClient(options) {
      calls.push(options);
    }
  };

  manager.enableOracleThickMode(oracledb);
  manager.enableOracleThickMode(oracledb);

  assert.deepEqual(calls, [{ libDir: '/opt/oracle/instantclient_19' }]);
});

test('Oracle Thick mode can use client libraries from the system loader path', () => {
  const manager = new DriverManager({ oracleThickMode: true });
  const calls = [];
  const oracledb = {
    initOracleClient(options) {
      calls.push(options);
    }
  };

  manager.enableOracleThickMode(oracledb);

  assert.deepEqual(calls, [undefined]);
});

test('Oracle Thick mode is not initialized by default', () => {
  const manager = new DriverManager();
  const calls = [];
  const oracledb = {
    initOracleClient(options) {
      calls.push(options);
    }
  };

  manager.enableOracleThickMode(oracledb);

  assert.deepEqual(calls, []);
});

test('MySQL timeout destroys the active connection instead of releasing it', async () => {
  const manager = new DriverManager();
  let destroyed = 0;
  let released = 0;
  let queryOptions = null;
  const connection = {
    execute(options) {
      queryOptions = options;
      return new Promise(() => {});
    },
    destroy() {
      destroyed += 1;
    },
    release() {
      released += 1;
    }
  };
  manager.pools.set('ds_mysql_timeout', {
    type: 'mysql',
    pool: { getConnection: async () => connection }
  });

  await assert.rejects(
    manager.execute(
      { id: 'ds_mysql_timeout', type: 'mysql' },
      'SELECT SLEEP(10)',
      [],
      { timeoutMs: 20, totalTimeoutMs: 20 }
    ),
    (error) => error.code === 'DB_QUERY_TIMEOUT'
  );

  assert.equal(destroyed, 1);
  assert.equal(released, 0);
  assert.ok(queryOptions.timeout > 0);
});

test('Oracle timeout requests breakExecution for the active statement', async () => {
  const manager = new DriverManager();
  let breaks = 0;
  const connection = {
    execute() {
      return new Promise(() => {});
    },
    async breakExecution() {
      breaks += 1;
    }
  };
  manager.pools.set('ds_oracle_timeout', {
    type: 'oracle',
    pool: { getConnection: async () => connection },
    oracledb: { OUT_FORMAT_OBJECT: 4002 }
  });

  await assert.rejects(
    manager.execute(
      { id: 'ds_oracle_timeout', type: 'oracle' },
      'SELECT 1 FROM dual',
      [],
      { timeoutMs: 20, totalTimeoutMs: 20 }
    ),
    (error) => error.code === 'DB_QUERY_TIMEOUT'
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(breaks, 1);
});

test('Oracle writes enable autoCommit', async () => {
  const manager = new DriverManager();
  let executeOptions = null;
  let closed = 0;
  const connection = {
    async execute(sql, binds, options) {
      executeOptions = options;
      return { rows: [], rowsAffected: 1 };
    },
    async close() {
      closed += 1;
    }
  };
  manager.pools.set('ds_oracle_write', {
    type: 'oracle',
    pool: { getConnection: async () => connection },
    oracledb: { OUT_FORMAT_OBJECT: 4002 }
  });

  const result = await manager.execute(
    { id: 'ds_oracle_write', type: 'oracle' },
    'UPDATE "USERS" SET "NAME" = :p0',
    ['Alice']
  );

  assert.equal(result.affectedRows, 1);
  assert.equal(executeOptions.autoCommit, true);
  assert.equal(closed, 1);
});

test('read-only datasource rejects writes before opening a connection', async () => {
  const manager = new DriverManager();
  let opened = 0;
  const connection = {
    async execute() {
      return [[{ id: 1 }], []];
    },
    release() {}
  };
  manager.pools.set('ds_readonly', {
    type: 'mysql',
    pool: {
      async getConnection() {
        opened += 1;
        return connection;
      }
    }
  });

  await assert.rejects(
    manager.execute(
      { id: 'ds_readonly', name: '只读库', type: 'mysql', readOnly: true },
      'DELETE FROM users WHERE id = ?',
      [1]
    ),
    (error) => error.status === 403 && error.code === 'DATASOURCE_READ_ONLY'
  );

  const result = await manager.execute(
    { id: 'ds_readonly', name: '只读库', type: 'mysql', readOnly: true },
    'SELECT id FROM users',
    []
  );
  assert.deepEqual(result.rows, [{ id: 1 }]);
  assert.equal(opened, 1);
});
