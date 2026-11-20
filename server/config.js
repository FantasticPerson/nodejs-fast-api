import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBasePath, parsePositiveInteger } from './utils.js';
import { normalizeTimeoutMs } from './timeout.js';

const serverDir = path.dirname(fileURLToPath(import.meta.url));

export const rootDir = path.resolve(serverDir, '..');

export function loadEnvFile(filePath = path.join(rootDir, '.env')) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    if (!key || process.env[key] !== undefined) continue;
    let value = trimmed.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value.replace(/\\n/g, '\n');
  }
}

export function loadConfig(overrides = {}) {
  loadEnvFile();
  const openapiPath = normalizeBasePath(process.env.OPENAPI_PATH || '/openapi');
  const stateFile = path.resolve(
    rootDir,
    process.env.STATE_FILE || 'data/state.json'
  );
  const stateDb = path.resolve(
    rootDir,
    process.env.STATE_DB || 'data/state.sqlite'
  );
  const secretFile = path.resolve(
    rootDir,
    process.env.SECRET_FILE || path.join(path.dirname(stateFile), '.secret')
  );

  return {
    rootDir,
    publicDir: path.join(rootDir, 'public'),
    host: process.env.HOST || '127.0.0.1',
    port: parsePositiveInteger(process.env.PORT, 3000, { min: 1, max: 65535 }),
    adminToken: (process.env.ADMIN_TOKEN || '').trim(),
    openapiToken: (process.env.OPENAPI_TOKEN || '').trim(),
    corsOrigin: (process.env.CORS_ORIGIN || '*').trim(),
    oracleThickMode: parseBoolean(process.env.ORACLE_THICK_MODE, false),
    oracleClientLibDir: (process.env.ORACLE_CLIENT_LIB_DIR || '').trim(),
    queryTimeoutMs: normalizeTimeoutMs(process.env.QUERY_TIMEOUT_MS, 30000),
    scriptTimeoutMs: normalizeTimeoutMs(process.env.SCRIPT_TIMEOUT_MS, 30000),
    scriptHttpAllowlist: parseList(process.env.SCRIPT_HTTP_ALLOWLIST),
    scriptHttpMaxResponseBytes: parsePositiveInteger(
      process.env.SCRIPT_HTTP_MAX_RESPONSE_BYTES,
      1024 * 1024,
      { min: 1, max: 20 * 1024 * 1024 }
    ),
    scriptWorkerMemoryMb: parsePositiveInteger(process.env.SCRIPT_WORKER_MEMORY_MB, 128, {
      min: 8,
      max: 1024
    }),
    pluginsDir: path.resolve(rootDir, process.env.PLUGINS_DIR || 'plugins'),
    openapiPath,
    managementPath: '/magic/api',
    stateDb,
    stateFile,
    secretFile,
    maxBodyBytes: 2 * 1024 * 1024,
    version: '1.0.0',
    ...overrides
  };
}

function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseList(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}
