const API_PREFIX = '/magic/api';
const TOKEN_KEY = 'node-magic-admin-token';

export class ApiError extends Error {
  constructor(message, { status = 500, code = 'REQUEST_FAILED', details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function getAdminToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function setAdminToken(token) {
  const value = String(token || '').trim();
  if (value) localStorage.setItem(TOKEN_KEY, value);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, signal } = {}) {
  const headers = { Accept: 'application/json' };
  const token = getAdminToken();
  if (token) headers['x-admin-token'] = token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_PREFIX}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal
    });
  } catch (error) {
    throw new ApiError(`无法连接服务：${error.message}`, { status: 0, code: 'NETWORK_ERROR' });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ApiError(`服务返回了非 JSON 响应（HTTP ${response.status}）`, {
        status: response.status,
        code: 'INVALID_RESPONSE'
      });
    }
  }
  if (!response.ok || payload?.ok === false) {
    const details = payload?.error?.details || null;
    throw new ApiError(payload?.error?.message || `请求失败（HTTP ${response.status}）`, {
      status: response.status,
      code: payload?.error?.code || 'REQUEST_FAILED',
      details
    });
  }
  return payload?.data;
}

export const api = {
  bootstrap: () => request('/bootstrap'),
  listDatasources: () => request('/datasources'),
  createDatasource: (input) => request('/datasources', { method: 'POST', body: input }),
  updateDatasource: (id, input) => request(`/datasources/${encodeURIComponent(id)}`, { method: 'PUT', body: input }),
  deleteDatasource: (id) => request(`/datasources/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testDatasourceDraft: (input) => request('/datasources/test', { method: 'POST', body: input }),
  testDatasource: (id) => request(`/datasources/${encodeURIComponent(id)}/test`, { method: 'POST', body: {} }),
  listTables: (id) => request(`/datasources/${encodeURIComponent(id)}/tables`),
  getTableInfo: (id, table) =>
    request(`/datasources/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/columns`),
  previewCrud: (id, table, input) =>
    request(`/datasources/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/preview`, {
      method: 'POST',
      body: input
    }),
  generateCrud: (id, table, input) =>
    request(`/datasources/${encodeURIComponent(id)}/tables/${encodeURIComponent(table)}/generate`, {
      method: 'POST',
      body: input
    }),
  createEndpoint: (input) => request('/endpoints', { method: 'POST', body: input }),
  updateEndpoint: (id, input) => request(`/endpoints/${encodeURIComponent(id)}`, { method: 'PUT', body: input }),
  deleteEndpoint: (id) => request(`/endpoints/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listEndpointVersions: (id) => request(`/endpoints/${encodeURIComponent(id)}/versions`),
  restoreEndpointVersion: (id, version) =>
    request(`/endpoints/${encodeURIComponent(id)}/versions/${encodeURIComponent(version)}/restore`, {
      method: 'POST',
      body: {}
    }),
  listScripts: () => request('/scripts'),
  createScript: (input) => request('/scripts', { method: 'POST', body: input }),
  updateScript: (name, input) =>
    request(`/scripts/${encodeURIComponent(name)}`, { method: 'PUT', body: input }),
  deleteScript: (name) => request(`/scripts/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  listScriptVersions: (name) => request(`/scripts/${encodeURIComponent(name)}/versions`),
  restoreScriptVersion: (name, version) =>
    request(`/scripts/${encodeURIComponent(name)}/versions/${encodeURIComponent(version)}/restore`, {
      method: 'POST',
      body: {}
    }),
  renderSql: (input) => request('/console/render', { method: 'POST', body: input }),
  runSql: (input) => request('/console/run', { method: 'POST', body: input }),
  clearLogs: () => request('/logs', { method: 'DELETE' }),
  openApiSpecUrl: () => `${location.origin}${API_PREFIX}/openapi.json`
};
