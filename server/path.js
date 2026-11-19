import { ValidationError } from './errors.js';

const PATH_PARAM_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const STATIC_SEGMENT_PATTERN = /^[^/?#\s]+$/;

export function normalizeEndpointPath(input) {
  let value = String(input ?? '').trim();
  if (!value) throw new ValidationError('接口路径不能为空');
  value = value.split(/[?#]/, 1)[0];
  if (!value.startsWith('/')) value = `/${value}`;
  if (value === '/') return '/';
  if (value.includes('//')) throw new ValidationError('接口路径不能包含连续斜杠');

  const segments = value.replace(/\/+$/, '').split('/').slice(1);
  for (const segment of segments) {
    if (!segment) throw new ValidationError('接口路径包含空路径段');
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!PATH_PARAM_PATTERN.test(name)) {
        throw new ValidationError(`路径参数名无效：${segment}`);
      }
    } else if (!STATIC_SEGMENT_PATTERN.test(segment)) {
      throw new ValidationError(`接口路径段无效：${segment}`);
    }
  }
  return `/${segments.join('/')}`;
}

export function compilePath(pattern) {
  const normalized = normalizeEndpointPath(pattern);
  if (normalized === '/') {
    return { pattern: normalized, regex: /^\/$/, keys: [] };
  }
  const keys = [];
  const source = normalized
    .split('/')
    .slice(1)
    .map((segment) => {
      if (segment.startsWith(':')) {
        keys.push(segment.slice(1));
        return '([^/]+)';
      }
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    })
    .join('/');
  return {
    pattern: normalized,
    regex: new RegExp(`^/${source}/?$`),
    keys
  };
}

export function matchCompiledPath(compiled, pathname) {
  const match = compiled.regex.exec(pathname);
  if (!match) return null;
  const params = {};
  compiled.keys.forEach((key, index) => {
    try {
      params[key] = decodeURIComponent(match[index + 1]);
    } catch {
      params[key] = match[index + 1];
    }
  });
  return params;
}

export function endpointPathSignature(pattern) {
  return normalizeEndpointPath(pattern)
    .split('/')
    .map((segment) => (segment.startsWith(':') ? '*' : segment))
    .join('/');
}

export function endpointPathParams(pattern) {
  return normalizeEndpointPath(pattern)
    .split('/')
    .filter((segment) => segment.startsWith(':'))
    .map((segment) => segment.slice(1));
}

export function endpointRouteScore(pattern) {
  return normalizeEndpointPath(pattern)
    .split('/')
    .filter(Boolean)
    .reduce((score, segment) => score + (segment.startsWith(':') ? 0 : 10), 0);
}

export function joinOpenApiPath(basePath, endpointPath) {
  const base = String(basePath || '').replace(/\/+$/, '');
  const path = String(endpointPath || '/');
  if (path === '/') return `${base}/`;
  return `${base}${path}`;
}

export function toOpenApiPath(endpointPath) {
  return endpointPath
    .split('/')
    .map((segment) => (segment.startsWith(':') ? `{${segment.slice(1)}}` : segment))
    .join('/');
}
