import test from 'node:test';
import assert from 'node:assert/strict';
import { DriverManager } from '../server/driver-manager.js';

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
