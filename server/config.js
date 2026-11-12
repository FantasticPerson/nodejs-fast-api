import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeBasePath, parsePositiveInteger } from './utils.js';

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
    openapiPath,
    managementPath: '/magic/api',
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
