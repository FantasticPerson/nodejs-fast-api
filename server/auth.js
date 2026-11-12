import { timingSafeEqual } from 'node:crypto';
import { isLoopback } from './utils.js';

export function readRequestToken(req) {
  const headerToken = req.headers['x-admin-token'];
  if (headerToken) return String(headerToken).trim();
  const authorization = req.headers.authorization || '';
  if (authorization.toLowerCase().startsWith('bearer ')) {
    return authorization.slice(7).trim();
  }
  return '';
}

export function safeTokenEqual(received, expected) {
  if (!received || !expected) return false;
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function isAdminAuthorized(req, config) {
  const remoteAddress = req.socket?.remoteAddress || '';
  if (config.adminToken) {
    const token = readRequestToken(req);
    return safeTokenEqual(token, config.adminToken);
  }
  return isLoopback(remoteAddress);
}
