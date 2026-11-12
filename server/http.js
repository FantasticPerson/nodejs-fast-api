import { AppError, ValidationError } from './errors.js';
import { compilePath, matchCompiledPath } from './path.js';

export class Router {
  constructor() {
    this.routes = [];
  }

  get(path, handler) {
    this.add('GET', path, handler);
  }

  post(path, handler) {
    this.add('POST', path, handler);
  }

  put(path, handler) {
    this.add('PUT', path, handler);
  }

  delete(path, handler) {
    this.add('DELETE', path, handler);
  }

  add(method, path, handler) {
    this.routes.push({ method, compiled: compilePath(path), handler });
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const params = matchCompiledPath(route.compiled, pathname);
      if (params) return { handler: route.handler, params };
    }
    return null;
  }
}

export async function readRawBody(req, limit = 2 * 1024 * 1024) {
  if (methodWithoutBody(req.method)) return Buffer.alloc(0);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new AppError('请求体超过大小限制', 413, 'BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export async function parsePayload(req, { limit = 2 * 1024 * 1024, allowForm = false } = {}) {
  const raw = await readRawBody(req, limit);
  if (!raw.length) return {};
  const contentType = String(req.headers['content-type'] || '').toLowerCase();
  if (contentType.includes('application/json') || contentType.includes('+json')) {
    try {
      return JSON.parse(raw.toString('utf8'));
    } catch {
      throw new ValidationError('请求体不是有效 JSON');
    }
  }
  if (allowForm && contentType.includes('application/x-www-form-urlencoded')) {
    return queryFromSearchParams(new URLSearchParams(raw.toString('utf8')));
  }
  if (allowForm && contentType.includes('multipart/form-data')) {
    throw new ValidationError('暂不支持 multipart/form-data，请使用 JSON 或表单编码');
  }
  if (!contentType && !raw.length) return {};
  throw new ValidationError('请求 Content-Type 必须是 application/json');
}

export function parseQuery(searchParams) {
  return queryFromSearchParams(searchParams);
}

function queryFromSearchParams(searchParams) {
  const output = {};
  for (const [key, value] of searchParams.entries()) {
    if (!(key in output)) {
      output[key] = value;
    } else if (Array.isArray(output[key])) {
      output[key].push(value);
    } else {
      output[key] = [output[key], value];
    }
  }
  return output;
}

export function normalizeHeaders(headers = {}) {
  const output = {};
  for (const [key, value] of Object.entries(headers)) {
    output[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : value;
  }
  return output;
}

export function setCommonHeaders(res) {
  if (res.headersSent) return;
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  if (res.headersSent) return;
  for (const [key, value] of Object.entries(extraHeaders)) res.setHeader(key, value);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(`${JSON.stringify(payload)}\n`);
}

export function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(text);
}

export function sendManagementError(res, error) {
  const appError = error instanceof AppError ? error : new AppError('服务器内部错误', 500, 'INTERNAL_ERROR');
  sendJson(res, appError.status, {
    ok: false,
    error: {
      code: appError.code,
      message: appError.message,
      ...(appError.details ? { details: appError.details } : {})
    }
  });
}

export function applyCors(req, res, config) {
  const origin = req.headers.origin;
  const configured = String(config.corsOrigin || '').trim();
  if (!origin || !configured) return;
  let allowed = '';
  if (configured === '*') {
    allowed = '*';
  } else {
    const list = configured.split(',').map((item) => item.trim()).filter(Boolean);
    if (list.includes(origin)) allowed = origin;
    res.setHeader('Vary', 'Origin');
  }
  if (!allowed) return;
  res.setHeader('Access-Control-Allow-Origin', allowed);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Api-Token, X-Admin-Token');
  res.setHeader('Access-Control-Max-Age', '600');
}

export function methodWithoutBody(method) {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

export function requestIp(req) {
  return req.socket?.remoteAddress || '';
}

export function notFound(res, message = '接口不存在') {
  sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message } });
}
