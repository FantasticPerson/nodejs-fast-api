import { createHash } from 'node:crypto';

export const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
  'localhost'
]);

export function isLoopback(address = '') {
  return LOOPBACK_ADDRESSES.has(address);
}

export function normalizeBasePath(pathname, fallback = '/openapi') {
  const value = String(pathname || fallback).trim();
  if (!value || value === '/') return fallback;
  const normalized = `/${value.replace(/^\/+|\/+$/g, '')}`;
  if (normalized === '/') return fallback;
  return normalized;
}

export function truncate(value, max = 600) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function hashText(value, length = 16) {
  return createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

export function parsePositiveInteger(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  if (number < min || number > max) return fallback;
  return number;
}

export function parseBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

export function jsonSafe(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object' && !(value instanceof Date) && !Buffer.isBuffer(value)) {
    const output = {};
    for (const [key, item] of Object.entries(value)) output[key] = jsonSafe(item);
    return output;
  }
  return value;
}

export function mergeHeaders(...sources) {
  const output = {};
  for (const source of sources) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source)) {
      output[String(key).toLowerCase()] = value;
    }
  }
  return output;
}

export function clone(value) {
  return structuredClone(value);
}
