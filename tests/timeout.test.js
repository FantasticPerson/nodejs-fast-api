import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_QUERY_TIMEOUT_MS,
  isDriverTimeoutError,
  normalizeTimeoutMs,
  resolveQueryTimeout,
  runWithTimeout
} from '../server/timeout.js';

test('runWithTimeout rejects with DB_QUERY_TIMEOUT and runs cancellation once', async () => {
  let cancelCount = 0;

  await assert.rejects(
    runWithTimeout(
      () => new Promise(() => {}),
      20,
      {
        totalTimeoutMs: 20,
        onTimeout() {
          cancelCount += 1;
        }
      }
    ),
    (error) => {
      assert.equal(error.code, 'DB_QUERY_TIMEOUT');
      assert.equal(error.status, 504);
      assert.deepEqual(error.details, { timeoutMs: 20 });
      return true;
    }
  );
  assert.equal(cancelCount, 1);
});

test('timeout normalization accepts zero to disable and caps oversized values', () => {
  assert.equal(normalizeTimeoutMs('0', 30000), 0);
  assert.equal(normalizeTimeoutMs('invalid', 30000), 30000);
  assert.equal(normalizeTimeoutMs(MAX_QUERY_TIMEOUT_MS + 1, 0), MAX_QUERY_TIMEOUT_MS);
  assert.equal(resolveQueryTimeout({ timeoutMs: 1500 }, 30000), 1500);
  assert.equal(resolveQueryTimeout({ timeoutMs: 0 }, 30000), 30000);
});

test('MySQL and Oracle driver timeout errors are recognized', () => {
  assert.equal(isDriverTimeoutError({ code: 'PROTOCOL_SEQUENCE_TIMEOUT' }), true);
  assert.equal(isDriverTimeoutError({ code: 'NJS-123' }), true);
  assert.equal(isDriverTimeoutError(new Error('call timeout of 100 ms exceeded')), true);
  assert.equal(isDriverTimeoutError(new Error('ORA-00942')), false);
});
