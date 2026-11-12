import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryService } from '../server/services/query-service.js';
import { compileTemplate, renderTemplate } from '../server/sql/template.js';

function fakeDriver(total = 3) {
  const calls = [];
  return {
    calls,
    async execute(datasource, sql, values) {
      calls.push({ datasource, sql, values });
      if (/COUNT\(\*\)/i.test(sql)) {
        return { rows: [{ __magic_total: total }] };
      }
      if (sql.includes('__magic_row_number')) {
        return { rows: [{ id: 1, __magic_row_number: 6 }] };
      }
      return { rows: [{ id: 1 }] };
    }
  };
}

test('Oracle pagination uses 11g-compatible ROWNUM binds and strips the marker column', async () => {
  const driverManager = fakeDriver(12);
  const service = new QueryService({ driverManager, endpointService: {} });
  const rendered = {
    dialect: 'oracle',
    sql: 'SELECT "ID" FROM "USERS" WHERE "ID" > :p0',
    values: [1]
  };

  const result = await service.executePaginated({
    endpoint: {},
    datasource: {},
    rendered,
    built: { page: 2, pageSize: 5 }
  });

  assert.equal(driverManager.calls.length, 2);
  assert.match(driverManager.calls[1].sql, /WHERE ROWNUM <= :p1/);
  assert.match(driverManager.calls[1].sql, /"__magic_row_number" > :p2/);
  assert.deepEqual(driverManager.calls[1].values, [1, 10, 5]);
  assert.deepEqual(result, { list: [{ id: 1 }], total: 12, page: 2, pageSize: 5, totalPages: 3 });
});

test('Oracle update rendering binds null values for COALESCE without changing bind order', () => {
  const ast = compileTemplate(
    'UPDATE "USERS" SET "NAME" = COALESCE(#{name}, "NAME") WHERE "ID" = #{id}'
  );
  const rendered = renderTemplate(ast, { name: null, id: 7 }, { dialect: 'oracle' });

  assert.equal(
    rendered.sql,
    'UPDATE "USERS" SET "NAME" = COALESCE(:p0, "NAME") WHERE "ID" = :p1'
  );
  assert.deepEqual(rendered.values, [null, 7]);
});
