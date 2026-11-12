import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateExpression } from '../server/sql/expression.js';
import { compileTemplate, renderTemplate, TemplateError } from '../server/sql/template.js';

test('expression evaluator supports null checks and boolean logic', () => {
  assert.equal(evaluateExpression("name != null and name != ''", { name: 'Alice' }), true);
  assert.equal(evaluateExpression("name != null and name != ''", { name: '' }), false);
  assert.equal(evaluateExpression('age >= 18 or vip', { age: 16, vip: true }), true);
  assert.equal(evaluateExpression('user.name == "Alice"', { user: { name: 'Alice' } }), true);
});

test('if, set and where tags render dynamic SQL', () => {
  const ast = compileTemplate(`
UPDATE users
<set>
  <if test="name != null">name = #{name},</if>
  <if test="age != null">age = #{age},</if>
</set>
<where>
  <if test="id != null">AND id = #{id}</if>
</where>`);
  const result = renderTemplate(ast, { name: 'Alice', id: 7 }, { dialect: 'mysql' });
  assert.match(result.sql, /SET name = \?/);
  assert.doesNotMatch(result.sql, /age =/);
  assert.match(result.sql, /WHERE id = \?/);
  assert.deepEqual(result.values, ['Alice', 7]);
});

test('foreach expands collection with separator and open/close', () => {
  const ast = compileTemplate('SELECT * FROM users WHERE id IN <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>');
  const result = renderTemplate(ast, { ids: [1, 2, 3] }, { dialect: 'oracle' });
  assert.equal(result.sql, 'SELECT * FROM users WHERE id IN (:p0,:p1,:p2)');
  assert.deepEqual(result.values, [1, 2, 3]);
});

test('choose picks the first matching branch', () => {
  const ast = compileTemplate('SELECT * FROM t WHERE 1 = 1 <choose><when test="status != null">AND status = #{status}</when><otherwise>AND status IS NULL</otherwise></choose>');
  const result = renderTemplate(ast, { status: 1 }, { dialect: 'mysql' });
  assert.match(result.sql, /status = \?/);
  assert.deepEqual(result.values, [1]);
});

test('raw substitution is rejected unless explicitly enabled', () => {
  const ast = compileTemplate('SELECT * FROM ${tableName}');
  assert.throws(
    () => renderTemplate(ast, { tableName: 'users' }, { dialect: 'mysql' }),
    (error) => error instanceof TemplateError && error.code === 'RAW_SQL_DISABLED'
  );
  const result = renderTemplate(ast, { tableName: 'users' }, { dialect: 'mysql', allowRawSql: true });
  assert.equal(result.sql, 'SELECT * FROM users');
});

test('unclosed tags produce readable errors', () => {
  assert.throws(
    () => compileTemplate('<if test="x != null">SELECT 1'),
    (error) => error instanceof TemplateError && error.code === 'TEMPLATE_UNCLOSED_TAG'
  );
});
