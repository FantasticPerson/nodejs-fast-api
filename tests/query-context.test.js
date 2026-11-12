import test from 'node:test';
import assert from 'node:assert/strict';
import { buildContext, coerceValue } from '../server/services/query-service.js';

test('buildContext reads declared locations, defaults and paging', () => {
  const endpoint = {
    params: [
      { name: 'keyword', in: 'query', type: 'string', required: false, defaultValue: null, description: '' },
      { name: 'id', in: 'path', type: 'number', required: true, defaultValue: null, description: '' },
      { name: 'active', in: 'body', type: 'boolean', required: false, defaultValue: 'true', description: '' }
    ],
    pagination: { enabled: true, maxPageSize: 100 }
  };
  const result = buildContext(endpoint, {
    query: { keyword: 'alice', page: '2', pageSize: '500' },
    body: {},
    path: { id: '42' },
    headers: {}
  });
  assert.equal(result.context.id, 42);
  assert.equal(result.context.keyword, 'alice');
  assert.equal(result.context.active, true);
  assert.equal(result.page, 2);
  assert.equal(result.pageSize, 100);
});

test('buildContext rejects missing required parameters', () => {
  const endpoint = {
    params: [{ name: 'id', in: 'path', type: 'number', required: true, defaultValue: null, description: '' }],
    pagination: { enabled: false }
  };
  assert.throws(() => buildContext(endpoint, { path: {}, query: {}, body: {}, headers: {} }), /缺少必填参数/);
});

test('coerceValue supports JSON, arrays and empty numeric values', () => {
  assert.equal(coerceValue('', 'number'), null);
  assert.deepEqual(coerceValue('1,2,3', 'array'), ['1', '2', '3']);
  assert.equal(coerceValue({ a: 1 }, 'json'), '{"a":1}');
  assert.equal(coerceValue('false', 'boolean'), false);
});
