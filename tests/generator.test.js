import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCrudDefinitions, slugifyTable } from '../server/generator.js';

function mysqlTable() {
  return {
    name: 'users',
    schema: 'demo',
    primaryKeys: ['id'],
    columns: [
      { name: 'id', dataType: 'BIGINT', kind: 'number', nullable: false, defaultValue: null, primaryKey: true, autoIncrement: true },
      { name: 'name', dataType: 'VARCHAR', kind: 'string', nullable: false, defaultValue: null, primaryKey: false, autoIncrement: false },
      { name: 'age', dataType: 'INT', kind: 'number', nullable: true, defaultValue: '18', primaryKey: false, autoIncrement: false },
      { name: 'created_at', dataType: 'DATETIME', kind: 'date', nullable: false, defaultValue: 'CURRENT_TIMESTAMP', primaryKey: false, autoIncrement: false }
    ]
  };
}

test('MySQL CRUD generator creates five endpoints with safe bindings', () => {
  const result = buildCrudDefinitions({
    datasource: { id: 'ds_1', type: 'mysql' },
    table: mysqlTable(),
    pathBase: '/users'
  });
  assert.equal(result.endpoints.length, 5);
  assert.deepEqual(result.endpoints.map((item) => `${item.method} ${item.path}`), [
    'GET /users',
    'GET /users/:id',
    'POST /users',
    'PUT /users/:id',
    'DELETE /users/:id'
  ]);
  const list = result.endpoints[0];
  assert.equal(list.pagination.enabled, true);
  assert.match(list.sql, /LIKE CONCAT/);
  assert.match(list.sql, /ORDER BY `id` DESC/);
  assert.match(result.endpoints[2].sql, /INSERT INTO `users`/);
  assert.match(result.endpoints[3].sql, /COALESCE/);
  assert.ok(result.endpoints.every((item) => item.datasourceId === 'ds_1'));
});

test('Oracle CRUD generator quotes identifiers and uses Oracle string concatenation', () => {
  const table = {
    ...mysqlTable(),
    name: 'USERS',
    schema: 'REPORT',
    columns: mysqlTable().columns.map((column) => ({
      ...column,
      name: column.name.toUpperCase(),
      dataType: column.dataType === 'VARCHAR' ? 'VARCHAR2' : column.dataType
    }))
  };
  table.primaryKeys = ['ID'];
  const result = buildCrudDefinitions({
    datasource: { id: 'ds_2', type: 'oracle' },
    table,
    pathBase: '/users'
  });
  const list = result.endpoints[0];
  assert.match(list.sql, /FROM "REPORT"."USERS"/);
  assert.match(list.sql, /LIKE '%' \|\| #{keyword} \|\| '%'/);
  assert.match(result.endpoints[1].sql, /WHERE "ID" = #{ID}/);
});

test('tables without a primary key can still generate list and create', () => {
  const table = {
    name: 'audit_log',
    schema: 'demo',
    primaryKeys: [],
    columns: [
      { name: 'message', dataType: 'TEXT', kind: 'string', nullable: true, defaultValue: null, primaryKey: false, autoIncrement: false }
    ]
  };
  const result = buildCrudDefinitions({
    datasource: { id: 'ds_1', type: 'mysql' },
    table,
    pathBase: '/audit-log',
    methods: ['list', 'create']
  });
  assert.deepEqual(result.endpoints.map((item) => item.method), ['GET', 'POST']);
});

test('slugifyTable creates stable URL names', () => {
  assert.equal(slugifyTable('USER_PROFILES'), 'user-profiles');
  assert.equal(slugifyTable('订单表'), 'resource');
});
