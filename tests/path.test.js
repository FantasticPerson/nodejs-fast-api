import test from 'node:test';
import assert from 'node:assert/strict';
import { compilePath, endpointPathSignature, normalizeEndpointPath } from '../server/path.js';

test('path normalization and route matching work with path params', () => {
  assert.equal(normalizeEndpointPath('users/'), '/users');
  const compiled = compilePath('/users/:id');
  assert.deepEqual(compiled.keys, ['id']);
  const match = compiled.regex.exec('/users/42');
  assert.ok(match);
});

test('route signatures treat different path param names as the same route shape', () => {
  assert.equal(endpointPathSignature('/users/:id'), endpointPathSignature('/users/:userId'));
  assert.notEqual(endpointPathSignature('/users/list'), endpointPathSignature('/users/:id'));
});
