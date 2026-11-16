import { AppError } from './errors.js';

export const MAX_QUERY_TIMEOUT_MS = 600_000;

export function normalizeTimeoutMs(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const number = Number.parseInt(String(value).trim(), 10);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.min(number, MAX_QUERY_TIMEOUT_MS);
}

export function resolveQueryTimeout(endpoint, defaultTimeoutMs = 0) {
  const endpointTimeout = normalizeTimeoutMs(endpoint?.timeoutMs, 0);
  return endpointTimeout || normalizeTimeoutMs(defaultTimeoutMs, 0);
}

export function createQueryDeadline(timeoutMs) {
  const duration = normalizeTimeoutMs(timeoutMs, 0);
  if (!duration) {
    return {
      timeoutMs: 0,
      remainingMs: () => 0,
      expired: () => false
    };
  }
  const expiresAt = Date.now() + duration;
  return {
    timeoutMs: duration,
    remainingMs: () => Math.max(0, expiresAt - Date.now()),
    expired: () => Date.now() >= expiresAt
  };
}

export function queryTimeoutError(timeoutMs) {
  const duration = normalizeTimeoutMs(timeoutMs, 0);
  const message = duration
    ? `数据库查询超时（${duration} ms）`
    : '数据库查询超时';
  return new AppError(message, 504, 'DB_QUERY_TIMEOUT', {
    ...(duration ? { timeoutMs: duration } : {})
  });
}

export function isDriverTimeoutError(error) {
  const code = String(error?.code || '').toUpperCase();
  if (code === 'PROTOCOL_SEQUENCE_TIMEOUT' || code === 'NJS-123' || code === 'DPI-1067') {
    return true;
  }
  return /query inactivity timeout|call timeout of \d+ ms exceeded/i.test(
    String(error?.message || '')
  );
}

export async function runWithTimeout(work, timeoutMs, { totalTimeoutMs = timeoutMs, onTimeout } = {}) {
  const duration = normalizeTimeoutMs(timeoutMs, 0);
  if (!duration) return work();

  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        const result = onTimeout?.();
        if (result?.catch) result.catch(() => {});
      } catch {
        // Cancellation is best effort; the timeout response must still be returned.
      }
      reject(queryTimeoutError(totalTimeoutMs || duration));
    }, duration);
  });

  try {
    return await Promise.race([Promise.resolve().then(work), timeoutPromise]);
  } finally {
    clearTimeout(timer);
  }
}
