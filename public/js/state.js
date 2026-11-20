export const state = {
  view: 'apis',
  datasources: [],
  endpoints: [],
  scripts: [],
  logs: [],
  config: {
    openapiPath: '/openapi',
    drivers: { mysql: false, oracle: false },
    adminTokenRequired: false,
    queryTimeoutMs: 30000,
    scriptTimeoutMs: 30000,
    scriptHttpAllowlist: [],
    plugins: [],
    pluginErrors: [],
    version: '1.0.0'
  },
  loading: true,
  authError: null,
  error: null,
  apiSearch: '',
  editor: null,
  modal: null,
  theme: localStorage.getItem('node-magic-theme') || 'light'
};

export function createBlankEditor() {
  const firstDatasource = state.datasources[0];
  return {
    id: null,
    name: '',
    method: 'GET',
    path: '/example',
    datasourceId: firstDatasource?.id || '',
    engine: 'sql',
    sql: 'SELECT * FROM <table>\nWHERE id = #{id}',
    scriptCode: "const row = await db.queryOne('SELECT 1 AS ok');\nreturn { params, row };",
    allowHttp: false,
    description: '',
    group: '',
    enabled: true,
    allowRawSql: false,
    timeoutMs: 0,
    params: [{ name: 'id', in: 'query', type: 'string', required: false, defaultValue: '', description: '' }],
    pagination: { enabled: false, maxPageSize: 100 },
    responseMode: 'wrap',
    testValues: '{\n  "id": "1"\n}',
    testPage: 1,
    testPageSize: 20,
    testResponse: null,
    scriptLogs: [],
    renderResponse: null
  };
}

export function cloneEditor(endpoint) {
  return {
    ...structuredClone(endpoint),
    engine: endpoint.engine || 'sql',
    scriptCode: endpoint.scriptCode || '',
    allowHttp: Boolean(endpoint.allowHttp),
    params: (endpoint.params || []).map((param) => ({
      ...param,
      defaultValue: param.defaultValue ?? '',
      description: param.description || ''
    })),
    pagination: {
      enabled: Boolean(endpoint.pagination?.enabled),
      maxPageSize: endpoint.pagination?.maxPageSize || 100
    },
    timeoutMs: endpoint.timeoutMs ?? 0,
    testValues: JSON.stringify(buildInitialValues(endpoint.params || []), null, 2),
    testPage: 1,
    testPageSize: endpoint.pagination?.maxPageSize ? Math.min(20, endpoint.pagination.maxPageSize) : 20,
    testResponse: null,
    renderResponse: null
  };
}

function buildInitialValues(params) {
  const values = {};
  for (const param of params) {
    if (param.defaultValue !== null && param.defaultValue !== undefined && param.defaultValue !== '') {
      values[param.name] = parsesDefault(param.defaultValue, param.type);
    } else {
      values[param.name] = sampleValue(param.type, param.name);
    }
  }
  return values;
}

function parsesDefault(value, type) {
  if (type === 'number') return Number(value);
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
