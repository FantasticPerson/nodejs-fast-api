import { ValidationError } from '../errors.js';

export function quoteIdentifier(name, dialect) {
  const value = String(name ?? '');
  if (!value || value.includes('\u0000')) {
    throw new ValidationError('数据库标识符无效');
  }
  if (dialect === 'oracle') {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return `\`${value.replace(/`/g, '``')}\``;
}

export function quoteTable(table, dialect) {
  if (dialect === 'oracle') {
    if (table.schema) {
      return `${quoteIdentifier(table.schema, dialect)}.${quoteIdentifier(table.name, dialect)}`;
    }
    return quoteIdentifier(table.name, dialect);
  }
  return quoteIdentifier(table.name, dialect);
}

export function validateTableName(name) {
  const value = String(name ?? '').trim();
  if (!value || !/^[A-Za-z0-9_$#@-]{1,128}$/.test(value)) {
    throw new ValidationError('表名格式无效');
  }
  return value;
}
