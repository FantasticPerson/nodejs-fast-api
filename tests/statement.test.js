import test from 'node:test';
import assert from 'node:assert/strict';
import { isSelectSql } from '../server/sql/statement.js';

test('query detection handles comments and CTEs', () => {
  assert.equal(isSelectSql('-- list users\nSELECT id FROM users'), true);
  assert.equal(isSelectSql('/* report */ WITH users AS (SELECT id FROM users) SELECT * FROM users'), true);
  assert.equal(isSelectSql("SELECT 'update' AS label FROM users"), true);
});

test('query detection rejects write statements and write CTEs', () => {
  assert.equal(isSelectSql('UPDATE users SET name = ?'), false);
  assert.equal(isSelectSql('WITH users AS (SELECT id FROM users) DELETE FROM users'), false);
  assert.equal(isSelectSql('BEGIN UPDATE users SET name = ?; END'), false);
});
