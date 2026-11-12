import test from 'node:test';
import assert from 'node:assert/strict';
import { getTableInfo } from '../server/metadata.js';

test('Oracle metadata reads uppercase result keys and primary keys', async () => {
  const calls = [];
  const driverManager = {
    async execute(datasource, sql, values) {
      calls.push({ sql, values });
      if (sql.includes('product_component_version')) {
        return { rows: [{ VERSION: '12.2.0.1.0' }] };
      }
      if (sql.includes('all_tab_columns')) {
        return {
          rows: [
            {
              NAME: 'ID',
              DATA_TYPE: 'NUMBER',
              NULLABLE: 'N',
              DEFAULT_VALUE: null,
              POSITION: 1,
              MAX_LENGTH: 22,
              NUMERIC_PRECISION: 10,
              NUMERIC_SCALE: 0,
              IDENTITY_COLUMN: 'YES'
            },
            {
              NAME: 'DISPLAY_NAME',
              DATA_TYPE: 'VARCHAR2',
              NULLABLE: 'Y',
              DEFAULT_VALUE: null,
              POSITION: 2,
              MAX_LENGTH: 200,
              NUMERIC_PRECISION: null,
              NUMERIC_SCALE: null,
              IDENTITY_COLUMN: 'NO'
            }
          ]
        };
      }
      return { rows: [{ NAME: 'ID' }] };
    }
  };

  const table = await getTableInfo(
    driverManager,
    { type: 'oracle', schema: 'report', username: 'report' },
    'users'
  );

  assert.equal(table.name, 'USERS');
  assert.equal(table.schema, 'REPORT');
  assert.deepEqual(table.primaryKeys, ['ID']);
  assert.equal(table.columns[0].name, 'ID');
  assert.equal(table.columns[0].primaryKey, true);
  assert.equal(table.columns[0].autoIncrement, true);
  assert.equal(table.columns[1].name, 'DISPLAY_NAME');
  assert.equal(table.columns[1].nullable, true);
  assert.deepEqual(calls[1].values, ['REPORT', 'USERS']);
});

test('Oracle 11g metadata avoids the 12c-only identity column', async () => {
  const calls = [];
  const driverManager = {
    async execute(datasource, sql, values) {
      calls.push({ sql, values });
      if (sql.includes('product_component_version')) {
        return { rows: [{ VERSION: '11.2.0.4.0' }] };
      }
      if (sql.includes('all_tab_columns')) {
        return {
          rows: [
            {
              NAME: 'EMP_ID',
              DATA_TYPE: 'NUMBER',
              NULLABLE: 'N',
              DEFAULT_VALUE: null,
              POSITION: 1,
              MAX_LENGTH: 22,
              NUMERIC_PRECISION: 10,
              NUMERIC_SCALE: 0
            }
          ]
        };
      }
      return { rows: [{ NAME: 'EMP_ID' }] };
    }
  };

  const table = await getTableInfo(
    driverManager,
    { type: 'oracle', schema: 'hr', username: 'hr' },
    'employees'
  );

  assert.equal(table.name, 'EMPLOYEES');
  assert.equal(table.columns[0].autoIncrement, false);
  assert.equal(calls.length, 3);
  assert.equal(calls.some((call) => call.sql.includes('identity_column')), false);
  assert.match(calls[0].sql, /product_component_version/);
});
