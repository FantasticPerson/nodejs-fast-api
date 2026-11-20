import { ValidationError } from '../errors.js';
import { isSelectSql, trimSql } from './statement.js';
import { compileTemplate, renderTemplate, TemplateError } from './template.js';

export function renderScriptSql(sql, params = {}, dialect = 'mysql') {
  const source = String(sql || '').trim();
  if (!source) throw new ValidationError('数据库 SQL 不能为空');
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new ValidationError('数据库绑定参数必须是对象');
  }
  let rendered;
  try {
    rendered = renderTemplate(compileTemplate(source), params, {
      dialect,
      allowRawSql: false
    });
  } catch (error) {
    if (error instanceof TemplateError) throw new ValidationError(error.message);
    throw error;
  }
  const finalSql = trimSql(rendered.sql);
  if (!finalSql) throw new ValidationError('数据库 SQL 渲染结果为空');
  return {
    sql: finalSql,
    values: rendered.values,
    isSelect: isSelectSql(finalSql)
  };
}
