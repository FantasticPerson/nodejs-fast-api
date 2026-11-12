import { NotFoundError, ValidationError } from './errors.js';
import { validateTableName } from './sql/identifiers.js';

export async function listTables(driverManager, datasource) {
  if (datasource.type === 'mysql') {
    const result = await driverManager.execute(
      datasource,
      `SELECT table_name AS name, table_type AS type, COALESCE(table_comment, '') AS comment
       FROM information_schema.tables
       WHERE table_schema = ? AND table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY table_name`,
      [datasource.database]
    );
    return result.rows.map((row) => ({
      name: row.name,
      type: row.type,
      comment: row.comment || ''
    }));
  }

  const schema = oracleSchema(datasource);
  const result = await driverManager.execute(
    datasource,
    `SELECT object_name AS name, object_type AS type
     FROM all_objects
     WHERE owner = :p0
       AND object_type IN ('TABLE', 'VIEW')
       AND object_name NOT LIKE 'BIN$%'
     ORDER BY object_name`,
    [schema]
  );
  return result.rows.map((row) => ({
    name: readRow(row, 'name'),
    type: readRow(row, 'type'),
    comment: ''
  }));
}

export async function getTableInfo(driverManager, datasource, inputTableName) {
  const tableName = validateTableName(inputTableName);
  if (datasource.type === 'mysql') {
    const columnsResult = await driverManager.execute(
      datasource,
      `SELECT column_name AS name,
              data_type AS data_type,
              is_nullable AS nullable,
              column_default AS default_value,
              extra AS extra,
              column_key AS column_key,
              character_maximum_length AS max_length,
              numeric_precision AS numeric_precision,
              numeric_scale AS numeric_scale,
              ordinal_position AS position
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ?
       ORDER BY ordinal_position`,
      [datasource.database, tableName]
    );
    if (!columnsResult.rows.length) throw new NotFoundError(`表不存在：${tableName}`);

    const columns = columnsResult.rows.map((row) =>
      normalizeColumn({
        name: readRow(row, 'name'),
        dataType: readRow(row, 'data_type'),
        nullable: readRow(row, 'nullable'),
        defaultValue: readRow(row, 'default_value'),
        extra: readRow(row, 'extra'),
        columnKey: readRow(row, 'column_key'),
        position: readRow(row, 'position'),
        maxLength: readRow(row, 'max_length'),
        precision: readRow(row, 'numeric_precision'),
        scale: readRow(row, 'numeric_scale'),
        identity: false
      })
    );
    return {
      name: tableName,
      schema: datasource.database,
      type: 'TABLE',
      primaryKeys: columns.filter((column) => column.primaryKey).map((column) => column.name),
      columns
    };
  }

  const schema = oracleSchema(datasource);
  const table = tableName.toUpperCase();
  const version = await getOracleDatabaseVersion(driverManager, datasource);
  const identityColumn = version >= 12 ? ',\n            c.identity_column AS identity_column' : '';
  const columnsResult = await driverManager.execute(
    datasource,
    `SELECT c.column_name AS name,
            c.data_type AS data_type,
            c.nullable AS nullable,
            c.data_default AS default_value,
            c.column_id AS position,
            c.data_length AS max_length,
            c.data_precision AS numeric_precision,
            c.data_scale AS numeric_scale${identityColumn}
     FROM all_tab_columns c
     WHERE c.owner = :p0 AND c.table_name = :p1
     ORDER BY c.column_id`,
    [schema, table]
  );
  if (!columnsResult.rows.length) throw new NotFoundError(`表不存在：${schema}.${table}`);

  const keyResult = await driverManager.execute(
    datasource,
    `SELECT acc.column_name AS name
     FROM all_constraints ac
     JOIN all_cons_columns acc
       ON ac.owner = acc.owner AND ac.constraint_name = acc.constraint_name
     WHERE ac.owner = :p0 AND ac.table_name = :p1 AND ac.constraint_type = 'P'
     ORDER BY acc.position`,
    [schema, table]
  );
  const primaryKeys = keyResult.rows.map((row) => readRow(row, 'name'));

  const columns = columnsResult.rows.map((row) =>
    normalizeColumn({
      name: readRow(row, 'name'),
      dataType: readRow(row, 'data_type'),
      nullable: readRow(row, 'nullable'),
      defaultValue: readRow(row, 'default_value'),
      extra: '',
      columnKey: primaryKeys.includes(readRow(row, 'name')) ? 'PRI' : '',
      position: readRow(row, 'position'),
      maxLength: readRow(row, 'max_length'),
      precision: readRow(row, 'numeric_precision'),
      scale: readRow(row, 'numeric_scale'),
      identity: String(readRow(row, 'identity_column') || '').toUpperCase() === 'YES'
    })
  );

  return {
    name: table,
    schema,
    type: 'TABLE',
    primaryKeys,
    columns
  };
}

async function getOracleDatabaseVersion(driverManager, datasource) {
  const result = await driverManager.execute(
    datasource,
    `SELECT version AS version
     FROM product_component_version
     WHERE product LIKE 'Oracle Database%' AND ROWNUM = 1`,
    []
  );
  return Number.parseInt(String(readRow(result.rows[0], 'version') || ''), 10) || 0;
}

export function normalizeColumn(input) {
  const nullableValue = String(input.nullable || '').trim().toLowerCase();
  const nullable = nullableValue === 'yes' || nullableValue === 'y';
  const extra = String(input.extra || '').toLowerCase();
  return {
    name: input.name,
    dataType: String(input.dataType || '').toUpperCase(),
    kind: columnKind(input.dataType),
    nullable,
    defaultValue: input.defaultValue ?? null,
    primaryKey: String(input.columnKey || '').toUpperCase() === 'PRI',
    autoIncrement: extra.includes('auto_increment') || Boolean(input.identity),
    position: Number(input.position || 0),
    maxLength: input.maxLength ?? null,
    precision: input.precision ?? null,
    scale: input.scale ?? null
  };
}

export function columnKind(dataType) {
  const type = String(dataType || '').toLowerCase();
  if (/jsonb?/.test(type)) return 'json';
  if (/bool/.test(type)) return 'boolean';
  if (/date|time|year/.test(type)) return 'date';
  if (/int|decimal|numeric|number|float|double|real|bit|money/.test(type)) return 'number';
  if (/blob|binary|varbinary|raw|bfile|image/.test(type)) return 'binary';
  if (/char|text|clob|string|uuid|enum|set|xm/.test(type)) return 'string';
  return 'string';
}

export function isSearchableColumn(column) {
  const type = String(column.dataType || '').toLowerCase();
  return /char|text|clob|varchar|nvarchar|uuid|enum/.test(type) && column.kind !== 'json';
}

export function oracleSchema(datasource) {
  const schema = String(datasource.schema || datasource.username || '').trim();
  if (!schema) throw new ValidationError('Oracle 数据源缺少 schema 或用户名');
  return schema.toUpperCase();
}

function readRow(row, key) {
  if (!row) return undefined;
  if (row[key] !== undefined) return row[key];
  const found = Object.keys(row).find((item) => item.toLowerCase() === key.toLowerCase());
  return found ? row[found] : undefined;
}
