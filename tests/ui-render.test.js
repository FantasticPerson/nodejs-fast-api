import test from 'node:test';
import assert from 'node:assert/strict';

test('management views render without a browser runtime', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.location = { origin: 'http://localhost:3000' };
  const { state } = await import('../public/js/state.js');
  const views = await import('../public/js/views.js');

  state.loading = false;
  state.config = {
    openapiPath: '/openapi',
    openapiTokenRequired: false,
    queryTimeoutMs: 30000,
    drivers: { mysql: true, oracle: false },
    version: '1.0.0'
  };
  state.datasources = [{
    id: 'ds_1',
    name: '主库',
    type: 'mysql',
    host: '127.0.0.1',
    port: 3306,
    database: 'demo',
    serviceName: '',
    schema: '',
    username: 'root',
    hasPassword: true,
    readOnly: true,
    endpointCount: 1,
    updatedAt: new Date().toISOString()
  }];
  state.endpoints = [{
    id: 'api_1',
    name: '用户列表',
    method: 'GET',
    path: '/users',
    datasourceId: 'ds_1',
    sql: 'SELECT * FROM users',
    description: '列表',
    group: '用户',
    enabled: true,
    allowRawSql: false,
    params: [],
    pagination: { enabled: true, maxPageSize: 100 },
    responseMode: 'wrap',
    callCount: 3,
    lastCalledAt: new Date().toISOString()
  }];

  for (const view of ['apis', 'datasources', 'logs', 'docs']) {
    state.view = view;
    const html = views.renderApp();
    assert.ok(html.length > 1000, `${view} should render content`);
    assert.match(html, /Node Magic/);
    assert.match(html, /moon-glyph/);
    assert.match(html, /fill="currentColor"/);
    assert.match(html, /M21 12\.79A9 9 0 1 1 11\.21 3/);
  }

  state.view = 'datasources';
  assert.match(views.renderApp(), /readonly-badge/);
  assert.match(views.renderApp(), /访问模式/);

  state.view = 'apis';
  state.apiGroup = '';
  const defaultGroupHtml = views.renderApp();
  assert.match(defaultGroupHtml, /data-action="api-group"/);
  assert.match(defaultGroupHtml, /默认分组/);
  assert.match(defaultGroupHtml, /data-group="" aria-pressed="true"/);
  assert.match(defaultGroupHtml, /data-group="用户" aria-pressed="false"/);

  state.apiGroup = '用户';
  const userGroupHtml = views.renderApp();
  assert.match(userGroupHtml, /data-group="用户" aria-pressed="true"/);
  assert.match(userGroupHtml, /用户列表/);

  state.editor = {
    ...state.endpoints[0],
    testValues: '{"page":1}',
    testPage: 1,
    testPageSize: 20,
    testResponse: { list: [] },
    renderResponse: { sql: 'SELECT 1', values: [] }
  };
  state.view = 'editor';
  const editorHtml = views.renderApp();
  assert.match(editorHtml, /在线调试/);
  assert.match(editorHtml, /预览 SQL/);
  assert.match(editorHtml, /接口超时（毫秒）/);
  assert.match(editorHtml, /0 = 使用全局 30000/);
  assert.match(editorHtml, /list="endpoint-group-options"/);
  assert.match(editorHtml, /placeholder="默认分组"/);
  assert.match(editorHtml, /<option value="用户"><\/option>/);

  state.scripts = [{
    name: 'helper',
    description: '用户辅助函数',
    enabled: true,
    code: "return { normalize(value) { return String(value || '').trim(); } };"
  }];
  state.config.plugins = [{ name: 'pricing', actions: ['calculate'] }];
  state.editor = {
    ...state.editor,
    engine: 'script',
    scriptCode: 'return { id: ctx.params.id };',
    allowHttp: false
  };
  const scriptHtml = views.renderApp();
  assert.match(scriptHtml, /本接口可用 API/);
  assert.match(scriptHtml, /script-complete-open/);
  assert.match(scriptHtml, /ctx\.libs\.helper\.normalize/);
  assert.match(scriptHtml, /查看共享脚本代码/);
  assert.match(scriptHtml, /script-completion-menu/);

  state.modal = { type: 'datasource', title: '添加数据源', data: { datasource: {} } };
  assert.match(views.renderModal(), /datasource-form/);
  assert.match(views.renderModal(), /name="readOnly"/);
  assert.match(views.renderModal(), /只读数据源/);
  state.modal = { type: 'confirm', title: '删除', message: '确认吗', data: {} };
  assert.match(views.renderModal(), /confirm-accept/);
});
