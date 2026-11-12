import { state } from './state.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function methodClass(method) {
  return `method-${String(method || 'GET').toLowerCase()}`;
}

export function datasourceName(id) {
  return state.datasources.find((item) => item.id === id)?.name || '未绑定数据源';
}

export function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function timeAgo(value) {
  if (!value) return '从未调用';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return formatDate(value);
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('zh-CN');
}

export function runtimeUrl(path) {
  const base = state.config.openapiPath || '/openapi';
  return `${location.origin}${base}${path === '/' ? '/' : path}`;
}

export function buildTestValues(params = []) {
  const output = {};
  for (const param of params) {
    if (param.defaultValue !== null && param.defaultValue !== undefined && param.defaultValue !== '') {
      output[param.name] = parseDefault(param.defaultValue, param.type || 'string');
    } else {
      output[param.name] = sampleValue(param.type || 'string', param.name);
    }
  }
  return output;
}

export function parseDefault(value, type) {
  if (type === 'number') {
    const number = Number(value);
    return Number.isFinite(number) ? number : value;
  }
  if (type === 'boolean') return String(value).toLowerCase() === 'true' || String(value) === '1';
  if (type === 'json') {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  if (type === 'array') return String(value).split(',').map((item) => item.trim());
  return value;
}

export function sampleValue(type, name = '') {
  if (type === 'number') return 1;
  if (type === 'boolean') return true;
  if (type === 'json') return { key: 'value' };
  if (type === 'array') return ['a', 'b'];
  if (type === 'date') return '2026-01-01T00:00:00Z';
  if (/id/i.test(name)) return '1';
  return 'demo';
}

export function buildCurl(endpoint) {
  const values = buildTestValues(endpoint.params || []);
  const runtimePath = (endpoint.path || '/').replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) =>
    encodeURIComponent(String(values[name] ?? 'value'))
  );
  const query = new URLSearchParams();
  const body = {};
  for (const param of endpoint.params || []) {
    if (param.in === 'query') {
      const value = values[param.name];
      if (Array.isArray(value)) {
        value.forEach((item) => query.append(param.name, String(item)));
      } else if (value !== undefined && value !== null && value !== '') {
        query.append(param.name, String(value));
      }
    } else if (param.in === 'body') {
      body[param.name] = values[param.name];
    }
  }
  if (endpoint.pagination?.enabled) {
    query.set('page', '1');
    query.set('pageSize', '20');
  }
  const url = `${runtimeUrl(runtimePath)}${query.size ? `?${query.toString()}` : ''}`;
  const method = endpoint.method || 'GET';
  const lines = [`curl -X ${method} ${shellQuote(url)}`];
  if (Object.keys(body).length) {
    lines.push(`  -H 'Content-Type: application/json'`);
    lines.push(`  -d ${shellQuote(JSON.stringify(body, null, 2))}`);
  }
  return lines.join(' \\\n');
}

export function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

export function slugify(name) {
  const slug = String(name || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || 'resource';
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    textarea.remove();
    return ok;
  }
}

export function showToast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const item = document.createElement('div');
  item.className = `toast toast-${type}`;
  item.textContent = message;
  root.appendChild(item);
  requestAnimationFrame(() => item.classList.add('toast-show'));
  setTimeout(() => {
    item.classList.remove('toast-show');
    setTimeout(() => item.remove(), 220);
  }, 3200);
}

export function setBusy(button, busy, busyLabel = '处理中…') {
  if (!button) return;
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
  } else {
    button.disabled = false;
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
  }
}

export function syntaxValues(values) {
  return JSON.stringify(values, null, 2);
}

export function errorMessage(error) {
  return error?.message || '操作失败';
}
