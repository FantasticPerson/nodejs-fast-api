import { state } from './state.js';
import { extractLibraryMethods, SCRIPT_API_QUICK_REFERENCE } from './script-completion.js';
import {
  buildCurl,
  buildTestValues,
  datasourceName,
  escapeHtml,
  formatDate,
  formatNumber,
  methodClass,
  runtimeUrl,
  slugify,
  timeAgo
} from './ui.js';

const ICONS = {
  code: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 4l-4 16"/></svg>',
  database: '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="5" rx="7" ry="3"/><path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7"/></svg>',
  activity: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12h4l2-6 4 12 2-6h6"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h9a4 4 0 0 1 4 4v12H9a4 4 0 0 1-4-4V4Z"/><path d="M5 16h13"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  key: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="15" r="4"/><path d="m11 12 8-8M15 8l2 2M17 6l2 2"/></svg>',
  sun: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg class="moon-glyph" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" stroke="none" d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.7M20 4v7h-7"/></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4 11.5-11.5Z"/></svg>',
  arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  table: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 10v10"/></svg>',
  spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 1.5 5.5L19 10l-5.5 1.5L12 17l-1.5-5.5L5 10l5.5-1.5L12 3Z"/></svg>'
};

const DEFAULT_API_GROUP = '';

function endpointGroupName(endpoint) {
  return String(endpoint?.group || '').trim();
}

function collectEndpointGroups(endpoints) {
  const counts = new Map([[DEFAULT_API_GROUP, 0]]);
  for (const endpoint of endpoints) {
    const name = endpointGroupName(endpoint);
    counts.set(name, (counts.get(name) || 0) + 1);
  }
  return Array.from(counts, ([name, count]) => ({ name, count })).sort((left, right) => {
    if (!left.name) return -1;
    if (!right.name) return 1;
    return left.name.localeCompare(right.name, 'zh-CN');
  });
}

function endpointSearchText(endpoint) {
  return `${endpoint.name} ${endpoint.method} ${endpoint.path} ${datasourceName(endpoint.datasourceId)} ${endpointGroupName(endpoint)}`.toLowerCase();
}

export function renderApp() {
  return `<div class="shell">
    ${renderSidebar()}
    <main class="main">
      ${renderTopbar()}
      <section class="content">
        ${renderCurrentView()}
      </section>
    </main>
  </div>`;
}

export function renderModal() {
  if (!state.modal) return '';
  const modal = state.modal;
  return `<div class="modal-backdrop" role="presentation">
    <div class="modal ${modal.size === 'wide' ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(modal.title || '对话框')}">
      <div class="modal-head">
        <div>
          <span class="eyebrow">${escapeHtml(modal.eyebrow || 'WORKSPACE')}</span>
          <h2>${escapeHtml(modal.title || '')}</h2>
        </div>
        <button class="icon-button" data-action="modal-close" aria-label="关闭">${ICONS.close}</button>
      </div>
      <div class="modal-body">${renderModalBody(modal)}</div>
      ${renderModalFooter(modal)}
    </div>
  </div>`;
}

function renderSidebar() {
  const activeView = state.view === 'editor' ? 'apis' : state.view;
  const nav = [
    ['apis', '接口', 'code'],
    ['scripts', '共享脚本', 'spark'],
    ['datasources', '数据源', 'database'],
    ['logs', '调用日志', 'activity'],
    ['docs', '接口文档', 'book']
  ];
  return `<aside class="sidebar">
    <div class="brand">
      <span class="brand-mark"><i></i><i></i><i></i></span>
      <span class="brand-copy"><strong>Node Magic</strong><small>API Studio</small></span>
    </div>
    <button class="new-api-button" data-action="api-new">${ICONS.plus}<span>新建接口</span></button>
    <nav class="side-nav">
      ${nav
        .map(
          ([view, label, icon]) => `<button class="nav-item ${activeView === view ? 'active' : ''}" data-action="nav" data-view="${view}">
            <span class="nav-icon">${ICONS[icon]}</span><span>${label}</span>
          </button>`
        )
        .join('')}
    </nav>
    <div class="sidebar-foot">
      <div class="driver-tile">
        <span class="eyebrow">DRIVERS</span>
        <div class="driver-row"><span>MySQL</span><span class="dot ${state.config.drivers?.mysql ? 'ok' : 'off'}"></span></div>
        <div class="driver-row"><span>Oracle</span><span class="dot ${state.config.drivers?.oracle ? 'ok' : 'off'}"></span></div>
      </div>
      <span class="version">v${escapeHtml(state.config.version || '1.0.0')}</span>
    </div>
  </aside>`;
}

function renderTopbar() {
  return `<header class="topbar">
    <div class="topbar-left">
      <span class="live-dot"></span>
      <span>本地工作台</span>
      <span class="slash">/</span>
      <span class="muted">SQL in. REST out.</span>
    </div>
    <div class="topbar-actions">
      <button class="ghost-button" data-action="refresh">${ICONS.refresh}<span>刷新</span></button>
      <button class="ghost-button" data-action="token-open">${ICONS.key}<span>访问令牌</span></button>
      <button class="icon-button theme-button" data-action="toggle-theme" aria-label="${state.theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}" title="${state.theme === 'dark' ? '切换为浅色主题' : '切换为深色主题'}">${state.theme === 'dark' ? ICONS.sun : ICONS.moon}</button>
    </div>
  </header>`;
}

function renderCurrentView() {
  if (state.loading) return renderLoading();
  if (state.authError) return renderAuthError();
  if (state.error) return renderFatalError();
  if (state.view === 'editor') return renderEditor();
  if (state.view === 'datasources') return renderDatasources();
  if (state.view === 'scripts') return renderScripts();
  if (state.view === 'logs') return renderLogs();
  if (state.view === 'docs') return renderDocs();
  return renderApis();
}

function renderLoading() {
  return `<div class="loading-view">
    <div class="skeleton skeleton-title"></div>
    <div class="skeleton-grid">
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
      <div class="skeleton skeleton-card"></div>
    </div>
  </div>`;
}

function renderAuthError() {
  return `<div class="state-panel">
    <span class="state-icon">${ICONS.key}</span>
    <span class="eyebrow">ACCESS CONTROL</span>
    <h1>管理界面需要访问令牌</h1>
    <p>${escapeHtml(state.authError)}</p>
    <div class="state-actions">
      <button class="primary-button" data-action="token-open">设置访问令牌</button>
      <button class="ghost-button" data-action="retry-boot">重新连接</button>
    </div>
  </div>`;
}

function renderFatalError() {
  return `<div class="state-panel">
    <span class="state-icon">${ICONS.activity}</span>
    <span class="eyebrow">CONNECTION</span>
    <h1>服务暂时不可用</h1>
    <p>${escapeHtml(state.error)}</p>
    <button class="primary-button" data-action="retry-boot">重试</button>
  </div>`;
}

function renderApis() {
  const active = state.endpoints.filter((item) => item.enabled).length;
  const calls = state.endpoints.reduce((sum, item) => sum + Number(item.callCount || 0), 0);
  const noDatasource = state.datasources.length === 0;
  const groups = collectEndpointGroups(state.endpoints);
  const selectedGroup = groups.find((group) => group.name === (state.apiGroup || '')) || groups[0];
  const groupEndpoints = state.endpoints.filter((endpoint) => endpointGroupName(endpoint) === selectedGroup.name);
  const search = String(state.apiSearch || '').trim().toLowerCase();
  const visibleCount = groupEndpoints.filter((endpoint) => !search || endpointSearchText(endpoint).includes(search)).length;
  const groupLabel = selectedGroup.name || '默认分组';
  return `<div class="view-head">
    <div>
      <span class="eyebrow">API WORKBENCH</span>
      <h1>把 SQL 变成 HTTP 接口</h1>
      <p>保存即生效，不需要 Controller、Service、DTO。绑定参数默认防注入。</p>
    </div>
    <div class="head-actions">
      <button class="secondary-button" data-action="nav" data-view="datasources">${ICONS.database}<span>管理数据源</span></button>
      <button class="primary-button" data-action="api-new">${ICONS.plus}<span>新建接口</span></button>
    </div>
  </div>
  ${noDatasource ? renderOnboarding() : ''}
  <div class="metric-grid">
    <div class="metric-card accent"><span class="eyebrow">ENDPOINTS</span><strong>${formatNumber(state.endpoints.length)}</strong><small>${active} 个正在启用</small></div>
    <div class="metric-card"><span class="eyebrow">DATASOURCES</span><strong>${formatNumber(state.datasources.length)}</strong><small>MySQL / Oracle</small></div>
    <div class="metric-card"><span class="eyebrow">CALLS</span><strong>${formatNumber(calls)}</strong><small>累计调用次数</small></div>
  </div>
  <div class="api-workspace">
    <aside class="api-group-panel" aria-label="接口分组">
      <div class="api-group-head">
        <span class="eyebrow">GROUPS</span>
        <h2>分组</h2>
      </div>
      <div class="api-group-list">
        ${groups.map((group) => `<button class="api-group-item${group.name === selectedGroup.name ? ' active' : ''}" data-action="api-group" data-group="${escapeHtml(group.name)}" aria-pressed="${group.name === selectedGroup.name ? 'true' : 'false'}">
          <span class="api-group-name">${escapeHtml(group.name || '默认分组')}</span>
          <span class="api-group-count">${formatNumber(group.count)}</span>
        </button>`).join('')}
      </div>
    </aside>
    <section class="api-group-content" aria-label="${escapeHtml(groupLabel)}接口列表">
      <div class="list-toolbar">
        <div>
          <h2>接口列表</h2>
          <span class="muted">${escapeHtml(groupLabel)} · ${formatNumber(groupEndpoints.length)} 个接口${search ? ` · ${formatNumber(visibleCount)} 个匹配` : ''}</span>
        </div>
        <div class="search-box">
          <span>⌕</span>
          <input id="api-search" placeholder="搜索当前分组" value="${escapeHtml(state.apiSearch)}" autocomplete="off">
        </div>
      </div>
      ${state.endpoints.length
        ? groupEndpoints.length
          ? renderEndpointList(groupEndpoints, state.apiSearch)
          : renderEmptyGroup(groupLabel)
        : renderEmptyEndpoints()}
    </section>
  </div>`;
}

function renderOnboarding() {
  return `<div class="notice notice-accent">
    <div class="notice-icon">${ICONS.spark}</div>
    <div>
      <strong>先从数据源开始</strong>
      <p>添加 MySQL 或 Oracle 连接后，可以浏览表结构并一键生成完整 CRUD 接口。</p>
    </div>
    <button class="secondary-button" data-action="ds-new">添加数据源</button>
  </div>`;
}

function renderEndpointList(endpoints = state.endpoints, query = '') {
  const needle = String(query || '').trim().toLowerCase();
  const anyMatch = endpoints.some((endpoint) => !needle || endpointSearchText(endpoint).includes(needle));
  return `<div class="endpoint-list">
    ${endpoints
      .map((endpoint) => {
        const fullPath = `${state.config.openapiPath}${endpoint.path === '/' ? '/' : endpoint.path}`;
        const search = endpointSearchText(endpoint);
        const filtered = needle && !search.includes(needle);
        return `<div class="endpoint-row${filtered ? ' is-filtered' : ''}" data-search="${escapeHtml(search)}">
          <button class="endpoint-main" data-action="api-edit" data-id="${escapeHtml(endpoint.id)}">
            <span class="method-badge ${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
            <span class="endpoint-copy">
              <span class="endpoint-name">${escapeHtml(endpoint.name)}</span>
              <code class="endpoint-path">${escapeHtml(fullPath)}</code>
            </span>
          </button>
          <div class="endpoint-meta">
            <span class="meta-label">数据源</span>
            <span>${escapeHtml(datasourceName(endpoint.datasourceId))}</span>
          </div>
          <div class="endpoint-meta endpoint-calls">
            <span class="meta-label">调用</span>
            <span>${formatNumber(endpoint.callCount)} <small>${escapeHtml(timeAgo(endpoint.lastCalledAt))}</small></span>
          </div>
          <div class="endpoint-actions">
            <button class="status-switch ${endpoint.enabled ? 'on' : ''}" data-action="api-toggle" data-id="${escapeHtml(endpoint.id)}" aria-label="${endpoint.enabled ? '停用' : '启用'}">
              <span></span><em>${endpoint.enabled ? '启用' : '停用'}</em>
            </button>
            <button class="icon-button" data-action="api-copy-curl" data-id="${escapeHtml(endpoint.id)}" aria-label="复制 cURL">${ICONS.copy}</button>
            <button class="icon-button" data-action="api-edit" data-id="${escapeHtml(endpoint.id)}" aria-label="编辑">${ICONS.edit}</button>
          </div>
        </div>`;
      })
      .join('')}
  </div>
  ${needle ? `<div class="api-search-empty${anyMatch ? ' is-filtered' : ''}">
    <strong>当前分组没有匹配的接口</strong>
    <p>换个关键词，或切换到其他分组继续查找。</p>
  </div>` : ''}`;
}

function renderEmptyGroup(groupName) {
  const isDefault = groupName === '默认分组';
  return `<div class="group-empty">
    <span class="eyebrow">EMPTY GROUP</span>
    <h2>${escapeHtml(groupName)}还没有接口</h2>
    <p>${isDefault ? '新建接口时分组留空，就会归入默认分组。' : `新建接口时把分组填成「${escapeHtml(groupName)}」，接口就会归入这里。`}</p>
    <button class="primary-button" data-action="api-new">${ICONS.plus}<span>新建接口</span></button>
  </div>`;
}

function renderEmptyEndpoints() {
  return `<div class="empty-state">
    <div class="empty-art"><span></span><i></i><b></b></div>
    <span class="eyebrow">START HERE</span>
    <h2>第一个接口只差一段 SQL</h2>
    <p>新建接口后，可以立即在页面里测试、预览渲染后的 SQL，并复制调用示例。</p>
    <button class="primary-button" data-action="api-new">${ICONS.plus}<span>创建第一个接口</span></button>
  </div>`;
}

function renderEditor() {
  const editor = state.editor;
  if (!editor) return '';
  const fullUrl = runtimeUrl(editor.path || '/');
  const hasDatasource = state.datasources.length > 0;
  return `<div class="editor-head">
    <button class="back-button" data-action="editor-back">${ICONS.back}<span>返回接口列表</span></button>
    <div class="editor-title">
      <span class="eyebrow">${editor.id ? 'EDIT ENDPOINT' : 'NEW ENDPOINT'}</span>
      <h1>${escapeHtml(editor.name || '未命名接口')}</h1>
      <code>${escapeHtml(fullUrl)}</code>
    </div>
    <div class="head-actions">
      ${editor.id ? `<button class="secondary-button" data-action="editor-versions">历史版本</button>` : ''}
      ${editor.id ? `<button class="danger-ghost-button" data-action="editor-delete">${ICONS.trash}<span>删除</span></button>` : ''}
      <button class="primary-button" data-action="editor-save">${ICONS.arrow}<span>${editor.id ? '保存并启用' : '创建接口'}</span></button>
    </div>
  </div>
  ${!hasDatasource ? `<div class="notice notice-warn"><div><strong>还没有数据源</strong><p>接口保存前需要先绑定一个 MySQL 或 Oracle 数据源。</p></div><button class="secondary-button" data-action="ds-new">添加数据源</button></div>` : ''}
  <div class="editor-shell">
    <div class="editor-main">
      ${renderRouteCard(editor)}
      ${editor.engine === 'script' ? renderScriptCard(editor) : renderSqlCard(editor)}
      ${renderTestCard(editor)}
    </div>
    <aside class="editor-side">
      ${renderParamsCard(editor)}
      ${renderOptionsCard(editor)}
      ${renderShareCard(editor, fullUrl)}
    </aside>
  </div>`;
}

function renderRouteCard(editor) {
  const groupOptions = collectEndpointGroups(state.endpoints)
    .filter((group) => group.name)
    .map((group) => group.name);
  return `<section class="editor-card">
    <div class="card-head"><div><span class="eyebrow">ROUTE</span><h2>接口信息</h2></div><span class="card-note">保存后立即生效</span></div>
    <div class="form-grid">
      <label class="field field-span-2"><span>接口名称</span><input data-field="name" value="${escapeHtml(editor.name)}" placeholder="例如：查询用户列表"></label>
      <label class="field"><span>请求方法</span>
        <select data-field="method" data-rerender="1">
          ${['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
            .map((method) => `<option value="${method}" ${editor.method === method ? 'selected' : ''}>${method}</option>`)
            .join('')}
        </select>
      </label>
      <label class="field"><span>实现方式</span>
        <select data-field="engine" data-rerender="1">
          <option value="sql" ${editor.engine !== 'script' ? 'selected' : ''}>SQL 接口</option>
          <option value="script" ${editor.engine === 'script' ? 'selected' : ''}>JavaScript 业务脚本</option>
        </select>
      </label>
      <label class="field"><span>接口路径</span><input data-field="path" value="${escapeHtml(editor.path)}" placeholder="/users/:id"></label>
      <label class="field"><span>数据源</span>
        <select data-field="datasourceId" data-rerender="1">
          <option value="">选择数据源</option>
          ${state.datasources
            .map((datasource) => `<option value="${escapeHtml(datasource.id)}" ${editor.datasourceId === datasource.id ? 'selected' : ''}>${escapeHtml(datasource.name)} · ${datasource.type}${datasource.readOnly ? ' · 只读' : ''}</option>`)
            .join('')}
        </select>
      </label>
      <label class="field"><span>分组</span><input data-field="group" list="endpoint-group-options" value="${escapeHtml(editor.group || '')}" placeholder="默认分组">
        <small class="field-help">不填写即默认分组，可选择已有分组或直接输入新名称。</small>
      </label>
      <label class="field field-span-2"><span>描述（可选）</span><textarea rows="2" data-field="description" placeholder="说明这个接口的用途、参数或返回结构">${escapeHtml(editor.description || '')}</textarea></label>
    </div>
    <datalist id="endpoint-group-options">
      ${groupOptions.map((group) => `<option value="${escapeHtml(group)}"></option>`).join('')}
    </datalist>
  </section>`;
}

function renderSqlCard(editor) {
  const lineCount = String(editor.sql || '').split('\n').length;
  const gutter = Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1).join('\n');
  return `<section class="editor-card sql-card">
    <div class="card-head">
      <div><span class="eyebrow">SQL TEMPLATE</span><h2>SQL 模板</h2></div>
      <div class="snippet-bar">
        <button data-action="editor-insert" data-snippet="#{name}"># 绑定</button>
        <button data-action="editor-insert" data-snippet="<if test=&quot;name != null and name != ''&quot;>\n  AND column_name = #{name}\n</if>">&lt;if&gt;</button>
        <button data-action="editor-insert" data-snippet="<foreach collection=&quot;ids&quot; item=&quot;id&quot; separator=&quot;,&quot;>\n  #{id}\n</foreach>">&lt;foreach&gt;</button>
      </div>
    </div>
    <div class="code-shell">
      <pre class="code-gutter" id="sql-gutter">${gutter}</pre>
      <textarea id="sql-input" class="code-input" data-field="sql" spellcheck="false" autocomplete="off">${escapeHtml(editor.sql)}</textarea>
    </div>
    <div class="code-help">
      <span><b>#{name}</b> 安全绑定参数</span>
      <span><b>${'${'}name}</b> 原样拼接，需在右侧开启</span>
      <span><b>&lt;if&gt;</b> / <b>&lt;foreach&gt;</b> 动态 SQL</span>
    </div>
  </section>`;
}

function renderScriptCard(editor) {
  const lineCount = String(editor.scriptCode || '').split('\n').length;
  const gutter = Array.from({ length: Math.max(1, lineCount) }, (_, index) => index + 1).join('\n');
  return `<section class="editor-card sql-card">
    <div class="card-head">
      <div><span class="eyebrow">BUSINESS SCRIPT</span><h2>JavaScript 业务脚本</h2></div>
      <div class="snippet-bar">
        <button data-action="editor-insert" data-snippet="const row = await db.queryOne('SELECT ...', { id: ctx.params.id });\n">db.queryOne</button>
        <button data-action="editor-insert" data-snippet="await db.transaction(async (tx) => {\n  await tx.execute('UPDATE ...', { id: ctx.params.id });\n});\n">事务</button>
        <button data-action="editor-insert" data-snippet="const response = await http.fetch('https://api.example.com/path');\n">http.fetch</button>
      </div>
    </div>
    <div class="code-shell">
      <pre class="code-gutter" id="script-gutter">${gutter}</pre>
      <textarea id="script-input" class="code-input" data-field="scriptCode" spellcheck="false" autocomplete="off" aria-autocomplete="list" aria-controls="script-completion-menu">${escapeHtml(editor.scriptCode)}</textarea>
    </div>
    <div class="code-help">
      <span><b>ctx.params</b> 请求参数</span>
      <span><b>db.query / queryOne / execute</b> 数据库调用</span>
      <span><b>db.transaction</b> 多语句事务</span>
      <span><b>ctx.libs</b> 共享脚本方法</span>
      <span><b>return</b> 返回 JSON 数据</span>
    </div>
    ${renderScriptApiReference()}
    <div class="notice notice-info"><div><strong>执行环境</strong><p>脚本在独立 Worker 中运行，只暴露受控的数据库、HTTP 和插件接口，不提供 require、process 和文件系统。</p></div></div>
  </section>`;
}

function renderScriptApiReference() {
  const libraries = state.scripts.filter((library) => library.enabled !== false);
  const plugins = state.config.plugins || [];
  return `<div class="script-api-panel">
    <div class="script-api-head">
      <div>
        <span class="eyebrow">SCRIPT API</span>
        <strong>本接口可用 API</strong>
        <p>输入 <code>ctx.</code> 自动提示；按 <kbd>Ctrl</kbd> + <kbd>Space</kbd> 手动打开补全。</p>
      </div>
      <button class="tiny-button" data-action="script-complete-open">打开补全</button>
    </div>
    <div class="script-api-quick">
      ${SCRIPT_API_QUICK_REFERENCE.map((item) => `<button class="api-ref-chip" data-action="script-insert-call" data-snippet="${escapeHtml(item.snippet)}"${item.caretOffset !== undefined ? ` data-caret-offset="${item.caretOffset}"` : ''} title="${escapeHtml(item.description)}">
        <code>${escapeHtml(item.label)}</code><small>${escapeHtml(item.description)}</small>
      </button>`).join('')}
    </div>
    <div class="script-api-section">
      <div class="script-api-section-head">
        <strong>共享脚本</strong>
        <span>${libraries.length} 个启用${plugins.length ? ` · ${plugins.length} 个插件` : ''}</span>
      </div>
      ${libraries.length ? `<div class="shared-script-reference">${libraries.map(renderSharedScriptReference).join('')}</div>` : '<div class="script-api-empty">暂无启用的共享脚本。启用后会出现在 <code>ctx.libs</code> 补全中。</div>'}
    </div>
  </div>`;
}

function renderSharedScriptReference(library) {
  const methods = extractLibraryMethods(library.code);
  const base = `ctx.libs.${library.name}.`;
  return `<article class="shared-script-reference-item">
    <div class="shared-script-reference-head">
      <div><code>ctx.libs.${escapeHtml(library.name)}</code><small>${escapeHtml(library.description || '共享脚本')}</small></div>
      <button class="tiny-button" data-action="script-insert-call" data-snippet="${escapeHtml(base)}" title="插入引用并打开方法补全">插入</button>
    </div>
    <div class="shared-method-list">
      ${methods.length ? methods.map((method) => {
        const snippet = `${base}${method.name}${method.call ? '()' : ''}`;
        return `<button class="shared-method-chip" data-action="script-insert-call" data-snippet="${escapeHtml(snippet)}"${method.call ? ` data-caret-offset="${snippet.length - 1}"` : ''} title="${escapeHtml(method.description || method.signature)}">
          <code>${escapeHtml(method.signature)}</code>${method.description ? `<small>${escapeHtml(method.description)}</small>` : ''}
        </button>`;
      }).join('') : '<span class="shared-method-empty">未静态识别到方法，请查看下方代码。</span>'}
    </div>
    <details class="shared-code"><summary>查看共享脚本代码</summary><pre>${escapeHtml(library.code)}</pre></details>
  </article>`;
}

function renderParamsCard(editor) {
  return `<section class="editor-card">
    <div class="card-head compact">
      <div><span class="eyebrow">PARAMETERS</span><h2>请求参数</h2></div>
      <div class="mini-actions">
        ${editor.engine === 'script' ? '' : '<button class="tiny-button" data-action="editor-extract-params">从 SQL 提取</button>'}
        <button class="tiny-button" data-action="editor-add-param">${ICONS.plus}</button>
      </div>
    </div>
    <div class="param-list">
      ${(editor.params || []).length ? editor.params.map(renderParamRow).join('') : '<div class="param-empty">没有显式参数。未声明变量会从 body、query、path 中自动查找。</div>'}
    </div>
    <div class="param-legend"><span>位置</span><span>query / body / path / header</span></div>
  </section>`;
}

function renderParamRow(param, index) {
  return `<div class="param-row">
    <div class="param-row-head">
      <input data-param-index="${index}" data-param-field="name" value="${escapeHtml(param.name)}" placeholder="参数名">
      <button class="icon-button param-remove" data-action="editor-remove-param" data-index="${index}" aria-label="删除参数">${ICONS.close}</button>
    </div>
    <div class="param-row-grid">
      <label><span>位置</span><select data-param-index="${index}" data-param-field="in" data-param-rerender="1">
        ${['query', 'body', 'path', 'header'].map((location) => `<option value="${location}" ${param.in === location ? 'selected' : ''}>${location}</option>`).join('')}
      </select></label>
      <label><span>类型</span><select data-param-index="${index}" data-param-field="type" data-param-rerender="1">
        ${['string', 'number', 'boolean', 'date', 'json', 'array'].map((type) => `<option value="${type}" ${param.type === type ? 'selected' : ''}>${type}</option>`).join('')}
      </select></label>
      <label><span>默认值</span><input data-param-index="${index}" data-param-field="defaultValue" value="${escapeHtml(param.defaultValue ?? '')}" placeholder="空"></label>
      <label class="check-label"><input type="checkbox" data-param-index="${index}" data-param-field="required" data-param-rerender="1" ${param.required ? 'checked' : ''}><span>必填</span></label>
    </div>
  </div>`;
}

function renderOptionsCard(editor) {
  const isScript = editor.engine === 'script';
  return `<section class="editor-card">
    <div class="card-head compact"><div><span class="eyebrow">BEHAVIOUR</span><h2>接口选项</h2></div></div>
    <div class="toggle-list">
      ${isScript ? `<div class="toggle-row">
        <div><strong>允许外部 HTTP</strong><small>仍需命中服务端 SCRIPT_HTTP_ALLOWLIST 白名单</small></div>
        <label class="switch"><input type="checkbox" data-field="allowHttp" data-rerender="1" ${editor.allowHttp ? 'checked' : ''}><span></span></label>
      </div>` : `<div class="toggle-row">
        <div><strong>自动分页</strong><small>SELECT 语句会增加 count 查询与分页片段</small></div>
        <label class="switch"><input type="checkbox" data-field="pageEnabled" data-rerender="1" ${editor.pagination?.enabled ? 'checked' : ''}><span></span></label>
      </div>
      ${editor.pagination?.enabled ? `<label class="field compact-field"><span>最大每页条数</span><input type="number" min="1" max="5000" data-field="pageMax" value="${escapeHtml(editor.pagination.maxPageSize || 100)}"></label>` : ''}
      <div class="toggle-row">
        <div><strong>允许原样 SQL</strong><small class="danger-text">开启后 ${'${'}name} 会直接拼接，存在注入风险</small></div>
        <label class="switch"><input type="checkbox" data-field="allowRawSql" data-rerender="1" ${editor.allowRawSql ? 'checked' : ''}><span></span></label>
      </div>`}
      <label class="field compact-field"><span>响应模式</span>
        <select data-field="responseMode" data-rerender="1">
          <option value="wrap" ${editor.responseMode !== 'raw' ? 'selected' : ''}>统一包装 { code, message, data }</option>
          <option value="raw" ${editor.responseMode === 'raw' ? 'selected' : ''}>直接返回 data</option>
        </select>
      </label>
      <label class="field compact-field"><span>接口超时（毫秒）</span>
        <input type="number" min="0" max="600000" data-field="timeoutMs" value="${escapeHtml(editor.timeoutMs || 0)}" placeholder="0 = 使用全局 ${escapeHtml((isScript ? state.config.scriptTimeoutMs : state.config.queryTimeoutMs) ?? 30000)}">
      </label>
      <div class="toggle-row">
        <div><strong>启用状态</strong><small>关闭后运行时会返回 404</small></div>
        <label class="switch"><input type="checkbox" data-field="enabled" data-rerender="1" ${editor.enabled ? 'checked' : ''}><span></span></label>
      </div>
    </div>
  </section>`;
}

function renderTestCard(editor) {
  const isScript = editor.engine === 'script';
  return `<section class="editor-card">
    <div class="card-head">
      <div><span class="eyebrow">PLAYGROUND</span><h2>在线调试</h2></div>
      <div class="mini-actions">
        ${isScript ? '' : '<button class="tiny-button" data-action="editor-render">预览 SQL</button>'}
        <button class="accent-button" data-action="editor-run">${isScript ? '运行脚本' : '运行接口'}</button>
      </div>
    </div>
    <div class="test-grid">
      <label class="field"><span>测试参数 JSON</span><textarea id="test-values" rows="9" spellcheck="false" data-role="test-values">${escapeHtml(editor.testValues || '{}')}</textarea></label>
      <div class="test-side">
        <div class="two-fields">
          <label class="field"><span>页码</span><input type="number" min="1" data-field="testPage" value="${escapeHtml(editor.testPage || 1)}"></label>
          <label class="field"><span>每页</span><input type="number" min="1" data-field="testPageSize" value="${escapeHtml(editor.testPageSize || 20)}"></label>
        </div>
        <div class="test-hint">
          <strong>快捷键</strong>
          <span><kbd>⌘</kbd> + <kbd>Enter</kbd> 运行</span>
        </div>
      </div>
    </div>
    ${editor.renderResponse ? `<div class="output-block"><div class="output-head"><span>渲染后的 SQL</span><button data-action="editor-copy-render">${ICONS.copy}</button></div><pre>${escapeHtml(JSON.stringify(editor.renderResponse, null, 2))}</pre></div>` : ''}
    ${editor.testResponse ? `<div class="output-block"><div class="output-head"><span>接口返回</span><button data-action="editor-copy-result">${ICONS.copy}</button></div><pre>${escapeHtml(JSON.stringify(editor.testResponse, null, 2))}</pre></div>` : ''}
    ${editor.scriptLogs?.length ? `<div class="output-block"><div class="output-head"><span>脚本日志</span></div><pre>${escapeHtml(JSON.stringify(editor.scriptLogs, null, 2))}</pre></div>` : ''}
    ${!editor.renderResponse && !editor.testResponse ? `<div class="output-empty">${isScript ? '点击“运行脚本”执行当前代码并查看返回结果。' : '点击“预览 SQL”查看绑定结果，点击“运行接口”执行真实查询。'}</div>` : ''}
  </section>`;
}

function renderShareCard(editor, fullUrl) {
  const curl = buildCurl(editor);
  return `<section class="editor-card">
    <div class="card-head compact"><div><span class="eyebrow">CALL IT</span><h2>调用示例</h2></div></div>
    <div class="url-box"><code>${escapeHtml(fullUrl)}</code><button class="icon-button" data-action="editor-copy-url" aria-label="复制地址">${ICONS.copy}</button></div>
    <div class="curl-block"><pre>${escapeHtml(curl)}</pre><button class="tiny-button" data-action="editor-copy-curl">复制 cURL</button></div>
  </section>`;
}

function renderDatasources() {
  const missing = [];
  if (!state.config.drivers?.mysql) missing.push('mysql2');
  if (!state.config.drivers?.oracle) missing.push('oracledb');
  return `<div class="view-head">
    <div><span class="eyebrow">CONNECTIONS</span><h1>数据源</h1><p>密码使用 AES-256-GCM 加密保存在本地状态文件中，不会出现在接口响应里。</p></div>
    <div class="head-actions"><button class="primary-button" data-action="ds-new">${ICONS.plus}<span>添加数据源</span></button></div>
  </div>
  ${missing.length ? `<div class="notice notice-warn"><div><strong>数据库驱动未安装</strong><p>管理页可以正常使用，但连接数据库前需安装：${missing.map((item) => `<code>npm install ${item}</code>`).join(' ')}</p></div></div>` : ''}
  ${state.datasources.length ? `<div class="datasource-grid">${state.datasources.map(renderDatasourceCard).join('')}</div>` : renderEmptyDatasources()}`;
}

function renderDatasourceCard(datasource) {
  const oracleSeparator = datasource.connectionType === 'sid' ? ':' : '/';
  const target = datasource.type === 'oracle'
    ? (datasource.connectString || `${datasource.host}:${datasource.port}${oracleSeparator}${datasource.serviceName}`)
    : `${datasource.host}:${datasource.port}/${datasource.database}`;
  return `<article class="datasource-card">
    <div class="ds-card-head">
      <div class="ds-type-group">
        <span class="db-type ${datasource.type}"><i></i>${datasource.type.toUpperCase()}</span>
        ${datasource.readOnly ? '<span class="readonly-badge">只读</span>' : ''}
      </div>
      <span class="endpoint-count">${formatNumber(datasource.endpointCount)} 个接口</span>
    </div>
    <h2>${escapeHtml(datasource.name)}</h2>
    <code class="ds-target">${escapeHtml(target)}</code>
    <div class="ds-meta-grid">
      <div><span>用户</span><strong>${escapeHtml(datasource.username)}</strong></div>
      <div><span>${datasource.type === 'oracle' ? 'Schema' : '数据库'}</span><strong>${escapeHtml(datasource.type === 'oracle' ? datasource.schema || '默认' : datasource.database)}</strong></div>
      <div><span>密码</span><strong>${datasource.hasPassword ? '已加密保存' : '未设置'}</strong></div>
      <div><span>访问模式</span><strong>${datasource.readOnly ? '只读' : '读写'}</strong></div>
      <div><span>更新</span><strong>${escapeHtml(formatDate(datasource.updatedAt))}</strong></div>
    </div>
    <div class="ds-actions">
      <button class="secondary-button" data-action="ds-tables" data-id="${escapeHtml(datasource.id)}">${ICONS.table}<span>浏览表</span></button>
      <button class="ghost-button" data-action="ds-test" data-id="${escapeHtml(datasource.id)}">测试连接</button>
      <button class="icon-button" data-action="ds-edit" data-id="${escapeHtml(datasource.id)}" aria-label="编辑">${ICONS.edit}</button>
      <button class="icon-button danger" data-action="ds-delete" data-id="${escapeHtml(datasource.id)}" aria-label="删除">${ICONS.trash}</button>
    </div>
  </article>`;
}

function renderEmptyDatasources() {
  return `<div class="empty-state">
    <div class="empty-art database-art"><span></span><i></i><b></b></div>
    <span class="eyebrow">CONNECT</span>
    <h2>连接你的 MySQL 或 Oracle</h2>
    <p>一个数据源可以被多个接口复用。添加后就能浏览表并生成 CRUD。</p>
    <button class="primary-button" data-action="ds-new">${ICONS.plus}<span>添加第一个数据源</span></button>
  </div>`;
}

function renderScripts() {
  return `<div class="view-head">
    <div>
      <span class="eyebrow">SHARED SCRIPTS</span>
      <h1>共享脚本库</h1>
      <p>这里的脚本会在启用状态下注入所有脚本接口，通过 <code>ctx.libs.名称.函数()</code> 复用。</p>
    </div>
    <button class="primary-button" data-action="script-new">${ICONS.plus}<span>新建共享脚本</span></button>
  </div>
  ${state.config.pluginErrors?.length ? `<div class="notice notice-warn"><div><strong>插件加载异常</strong><p>${escapeHtml(state.config.pluginErrors.map((item) => `${item.file}: ${item.message}`).join('；'))}</p></div></div>` : ''}
  ${state.scripts.length ? `<div class="endpoint-list">${state.scripts.map(renderScriptRow).join('')}</div>` : `<div class="empty-state">
    <span class="eyebrow">REUSABLE LOGIC</span>
    <h2>把重复逻辑抽成共享脚本</h2>
    <p>共享脚本必须返回一个对象；对象里的函数可以在任意脚本接口中复用。</p>
    <button class="primary-button" data-action="script-new">${ICONS.plus}<span>创建第一个共享脚本</span></button>
  </div>`}`;
}

function renderScriptRow(library) {
  return `<div class="endpoint-row">
    <button class="endpoint-main" data-action="script-edit" data-name="${escapeHtml(library.name)}">
      <span class="method-badge ${library.enabled ? 'get' : ''}">${library.enabled ? 'ON' : 'OFF'}</span>
      <span class="endpoint-copy">
        <span class="endpoint-name">${escapeHtml(library.name)}</span>
        <code class="endpoint-path">${escapeHtml(library.description || '共享脚本')}</code>
      </span>
    </button>
    <div class="endpoint-meta"><span class="meta-label">更新</span><span>${escapeHtml(timeAgo(library.updatedAt))}</span></div>
    <div class="endpoint-actions">
      <button class="tiny-button" data-action="script-versions" data-name="${escapeHtml(library.name)}">版本</button>
      <button class="icon-button" data-action="script-edit" data-name="${escapeHtml(library.name)}" aria-label="编辑">${ICONS.edit}</button>
      <button class="icon-button" data-action="script-delete" data-name="${escapeHtml(library.name)}" aria-label="删除">${ICONS.trash}</button>
    </div>
  </div>`;
}

function renderLogs() {
  return `<div class="view-head">
    <div><span class="eyebrow">REQUEST TRACE</span><h1>调用日志</h1><p>日志保存在内存中，最多 200 条；不会记录请求体和任何密钥。</p></div>
    <div class="head-actions">
      <button class="ghost-button" data-action="logs-clear">${ICONS.trash}<span>清空日志</span></button>
      <button class="secondary-button" data-action="logs-refresh">${ICONS.refresh}<span>刷新</span></button>
    </div>
  </div>
  ${state.logs.length ? `<div class="log-table">
    <div class="log-head"><span>时间</span><span>接口</span><span>状态</span><span>耗时</span><span>来源</span><span>错误</span></div>
    ${state.logs.map((log) => `<div class="log-row">
      <span class="log-time">${escapeHtml(formatDate(log.timestamp))}</span>
      <span class="log-endpoint"><span class="method-badge mini ${methodClass(log.method)}">${escapeHtml(log.method)}</span><code>${escapeHtml(log.path)}</code></span>
      <span><span class="status-code ${Number(log.status) >= 400 ? 'bad' : 'good'}">${escapeHtml(log.status)}</span></span>
      <span>${escapeHtml(log.durationMs)} ms</span>
      <span class="muted">${escapeHtml(log.sourceIp || '—')}</span>
      <span class="log-error">${escapeHtml(log.error || '—')}</span>
    </div>`).join('')}
  </div>` : '<div class="empty-state small"><span class="eyebrow">NO CALLS YET</span><h2>还没有调用记录</h2><p>运行任意接口后，这里会出现方法、状态、耗时和错误信息。</p></div>'}`;
}

function renderDocs() {
  const enabled = state.endpoints.filter((item) => item.enabled);
  const specUrl = `${location.origin}/magic/api/openapi.json`;
  return `<div class="view-head">
    <div><span class="eyebrow">API REFERENCE</span><h1>接口文档</h1><p>由已启用的接口自动生成；OpenAPI JSON 可直接接入 Swagger UI 或其他文档工具。</p></div>
    <div class="head-actions"><button class="secondary-button" data-action="copy-openapi-url">${ICONS.copy}<span>复制 OpenAPI 地址</span></button></div>
  </div>
  <div class="doc-hero">
    <div><span class="eyebrow">OPENAPI 3.0</span><h2>${escapeHtml(specUrl)}</h2><p>${state.config.openapiTokenRequired ? '访问文档需管理令牌，运行接口需 x-api-token。' : '运行接口未配置额外 token。'}</p></div>
    <span class="doc-count">${formatNumber(enabled.length)} <small>OPERATIONS</small></span>
  </div>
  ${enabled.length ? `<div class="doc-list">${enabled.map(renderDocEndpoint).join('')}</div>` : '<div class="empty-state small"><span class="eyebrow">NO ENABLED ENDPOINTS</span><h2>还没有启用中的接口</h2><p>创建并启用接口后，文档会自动出现在这里。</p></div>'}`;
}

function renderDocEndpoint(endpoint) {
  const fullPath = `${state.config.openapiPath}${endpoint.path === '/' ? '/' : endpoint.path}`;
  const curl = buildCurl(endpoint);
  return `<article class="doc-card">
    <div class="doc-card-head">
      <span class="method-badge ${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span>
      <div><h2>${escapeHtml(endpoint.name)}</h2><code>${escapeHtml(fullPath)}</code></div>
      <button class="tiny-button" data-action="doc-copy-curl" data-id="${escapeHtml(endpoint.id)}">复制 cURL</button>
    </div>
    ${endpoint.description ? `<p class="doc-description">${escapeHtml(endpoint.description)}</p>` : ''}
    <div class="doc-detail-grid">
      <div>
        <span class="eyebrow">PARAMETERS</span>
        ${(endpoint.params || []).length ? `<div class="doc-params">${endpoint.params.map((param) => `<div><span class="param-location">${escapeHtml(param.in)}</span><code>${escapeHtml(param.name)}</code><span>${escapeHtml(param.type)}${param.required ? ' · 必填' : ''}</span></div>`).join('')}</div>` : '<p class="muted">无显式参数</p>'}
        ${endpoint.pagination?.enabled ? '<p class="doc-paging">分页参数：<code>page</code>、<code>pageSize</code>（最大 ' + escapeHtml(endpoint.pagination.maxPageSize) + '）</p>' : ''}
      </div>
      <div><span class="eyebrow">CURL</span><pre class="doc-curl">${escapeHtml(curl)}</pre></div>
    </div>
  </article>`;
}

function renderModalBody(modal) {
  if (modal.type === 'datasource') return renderDatasourceModal(modal);
  if (modal.type === 'tables') return renderTablesModal(modal);
  if (modal.type === 'generator') return renderGeneratorModal(modal);
  if (modal.type === 'token') return renderTokenModal(modal);
  if (modal.type === 'script-library') return renderScriptLibraryModal(modal);
  if (modal.type === 'versions') return renderVersionsModal(modal);
  if (modal.type === 'confirm') return renderConfirmModal(modal);
  return '';
}

function renderModalFooter(modal) {
  if (modal.type === 'datasource') {
    return `<div class="modal-foot"><div id="ds-test-result" class="test-result"></div><div class="modal-foot-actions">
      <button class="ghost-button" data-action="modal-close">取消</button>
      <button class="secondary-button" data-action="ds-test-draft">测试连接</button>
      <button class="primary-button" data-action="ds-save">保存数据源</button>
    </div></div>`;
  }
  if (modal.type === 'token') {
    return `<div class="modal-foot"><div></div><div class="modal-foot-actions"><button class="ghost-button" data-action="modal-close">取消</button><button class="primary-button" data-action="token-save">保存令牌</button></div></div>`;
  }
  if (modal.type === 'confirm') {
    return `<div class="modal-foot"><div></div><div class="modal-foot-actions"><button class="ghost-button" data-action="modal-close">取消</button><button class="${modal.danger ? 'danger-button' : 'primary-button'}" data-action="confirm-accept">${escapeHtml(modal.confirmLabel || '确认')}</button></div></div>`;
  }
  if (modal.type === 'generator') {
    return `<div class="modal-foot"><div class="muted">生成后接口立即可用，路径冲突会中止整批创建。</div><div class="modal-foot-actions"><button class="ghost-button" data-action="modal-close">取消</button><button class="primary-button" data-action="crud-generate">生成接口</button></div></div>`;
  }
  if (modal.type === 'script-library') {
    return `<div class="modal-foot"><div class="muted">启用后会自动注入脚本接口。</div><div class="modal-foot-actions"><button class="ghost-button" data-action="modal-close">取消</button><button class="primary-button" data-action="script-save">保存共享脚本</button></div></div>`;
  }
  return '';
}

function renderScriptLibraryModal(modal) {
  const script = modal.data?.script || {};
  const existing = Boolean(modal.data?.existing);
  return `<div class="modal-intro">共享脚本代码必须 <code>return</code> 一个对象。例如返回 <code>{ normalize(row) { ... } }</code> 后，接口脚本可通过 <code>ctx.libs.${escapeHtml(script.name || '名称')}.normalize(row)</code> 调用。</div>
  <form id="script-library-form" class="modal-form">
    <div class="form-grid">
      <label class="field"><span>名称</span><input name="name" value="${escapeHtml(script.name || '')}" ${existing ? 'readonly' : ''} placeholder="例如：customer_helpers"></label>
      <label class="field"><span>启用</span><select name="enabled"><option value="true" ${script.enabled !== false ? 'selected' : ''}>启用</option><option value="false" ${script.enabled === false ? 'selected' : ''}>停用</option></select></label>
      <label class="field field-span-2"><span>描述</span><input name="description" value="${escapeHtml(script.description || '')}" placeholder="说明共享脚本的用途"></label>
      <label class="field field-span-2"><span>脚本代码</span><textarea name="code" rows="16" spellcheck="false" class="code-textarea">${escapeHtml(script.code || "return {\n  normalize(value) {\n    return String(value || '').trim();\n  }\n};")}</textarea></label>
    </div>
  </form>`;
}

function renderVersionsModal(modal) {
  const versions = modal.data?.versions || [];
  return `<div class="modal-intro">每次保存都会生成一个新版本。恢复历史版本会以该版本内容重新保存，并生成新的当前版本。</div>
    ${versions.length ? `<div class="endpoint-list">${versions.map((item) => `<div class="endpoint-row">
      <div class="endpoint-main"><span class="method-badge get">v${escapeHtml(item.version)}</span><span class="endpoint-copy"><span class="endpoint-name">${escapeHtml(formatDate(item.createdAt))}</span><code class="endpoint-path">${escapeHtml(versionSummary(item.definition))}</code></span></div>
      <div class="endpoint-actions"><button class="tiny-button" data-action="version-restore" data-kind="${escapeHtml(modal.data.kind)}" data-target="${escapeHtml(modal.data.target)}" data-version="${escapeHtml(item.version)}">恢复此版本</button></div>
    </div>`).join('')}</div>` : '<div class="output-empty">还没有历史版本。</div>'}`;
}

function versionSummary(definition = {}) {
  if (definition.engine === 'script' || definition.code) {
    return String(definition.name || definition.code || '脚本').slice(0, 80);
  }
  return String(definition.name || 'SQL 接口').slice(0, 80);
}

function renderDatasourceModal(modal) {
  const ds = modal.data?.datasource || {};
  return `<div class="modal-intro">支持 MySQL 与 Oracle。Oracle 需要服务名 / SID，或填写完整连接字符串；Oracle 11g 还需配置 Thick 模式与 Oracle Client 库。</div>
  <form id="datasource-form" class="modal-form">
    <div class="form-grid">
      <label class="field field-span-2"><span>名称</span><input name="name" value="${escapeHtml(ds.name || '')}" placeholder="例如：生产用户库" required></label>
      <label class="field"><span>类型</span><select name="type" id="ds-type">
        <option value="mysql" ${ds.type !== 'oracle' ? 'selected' : ''}>MySQL</option>
        <option value="oracle" ${ds.type === 'oracle' ? 'selected' : ''}>Oracle</option>
      </select></label>
      <label class="field"><span>主机</span><input name="host" value="${escapeHtml(ds.host || '127.0.0.1')}" placeholder="127.0.0.1"></label>
      <label class="field"><span>端口</span><input name="port" type="number" value="${escapeHtml(ds.port || '')}" placeholder="3306 / 1521"></label>
      <label class="field"><span>MySQL 数据库</span><input name="database" value="${escapeHtml(ds.database || '')}" placeholder="database_name"></label>
      <label class="field"><span>Oracle 连接方式</span><select name="connectionType">
        <option value="serviceName" ${ds.connectionType !== 'sid' ? 'selected' : ''}>服务名</option>
        <option value="sid" ${ds.connectionType === 'sid' ? 'selected' : ''}>SID</option>
      </select></label>
      <label class="field"><span>Oracle 服务名 / SID 值</span><input name="serviceName" value="${escapeHtml(ds.serviceName || '')}" placeholder="ORCL"></label>
      <label class="field"><span>Oracle Schema（可选）</span><input name="schema" value="${escapeHtml(ds.schema || '')}" placeholder="默认使用用户名"></label>
      <label class="field field-span-2"><span>Oracle 连接字符串（可选，覆盖主机配置）</span><input name="connectString" value="${escapeHtml(ds.connectString || '')}" placeholder="host:port/service_name"></label>
      <label class="field"><span>用户名</span><input name="username" value="${escapeHtml(ds.username || '')}" placeholder="db_user"></label>
      <label class="field"><span>密码</span><input name="password" type="password" value="" placeholder="${ds.id && ds.hasPassword ? '留空则保持原密码' : '数据库密码'}"></label>
      <div class="field field-span-2 ds-readonly-row">
        <div><strong>只读数据源</strong><small>开启后只允许执行查询语句，写操作会在执行前被拒绝。数据库账号权限仍是最终边界。</small></div>
        <label class="switch"><input type="checkbox" name="readOnly" ${ds.readOnly ? 'checked' : ''}><span></span></label>
      </div>
    </div>
  </form>`;
}

function renderTablesModal(modal) {
  const data = modal.data || {};
  if (data.loading) return `<div class="modal-loading"><span class="spinner"></span><p>正在读取表结构…</p></div>`;
  if (data.error) return `<div class="notice notice-warn"><div><strong>读取失败</strong><p>${escapeHtml(data.error)}</p></div></div>`;
  const tables = data.tables || [];
  return `<div class="table-browser">
    <div class="table-browser-left">
      <div class="browser-search"><input id="table-search" placeholder="搜索表名" autocomplete="off"></div>
      <div class="table-list" id="table-list">
        ${tables.map((table) => `<button class="table-item ${data.selectedTable === table.name ? 'active' : ''}" data-action="table-select" data-table="${escapeHtml(table.name)}" data-table-name="${escapeHtml(table.name.toLowerCase())}">
          <span>${ICONS.table}</span><div><strong>${escapeHtml(table.name)}</strong><small>${escapeHtml(table.type)}${table.comment ? ' · ' + escapeHtml(table.comment) : ''}</small></div>
        </button>`).join('')}
      </div>
      <span class="table-count">${formatNumber(tables.length)} 张表 / 视图</span>
    </div>
    <div class="table-browser-right">
      ${data.columnsLoading ? '<div class="modal-loading"><span class="spinner"></span><p>正在读取字段…</p></div>' : data.tableInfo ? renderTableInfo(data.tableInfo) : '<div class="browser-empty">从左侧选择一张表，查看字段和主键。</div>'}
    </div>
  </div>`;
}

function renderTableInfo(table) {
  return `<div class="table-info-head">
    <div><span class="eyebrow">TABLE</span><h3>${escapeHtml(table.name)}</h3><p>${escapeHtml(table.schema || '')}</p></div>
    <button class="primary-button" data-action="crud-open"><span>${ICONS.spark}</span>生成 CRUD</button>
  </div>
  <div class="pk-strip"><span>主键</span>${table.primaryKeys?.length ? table.primaryKeys.map((pk) => `<code>${escapeHtml(pk)}</code>`).join('') : '<em>无主键</em>'}</div>
  <div class="column-table">
    <div class="column-head"><span>字段</span><span>类型</span><span>可空</span><span>默认</span><span>标记</span></div>
    ${table.columns.map((column) => `<div class="column-row">
      <code>${escapeHtml(column.name)}</code>
      <span>${escapeHtml(column.dataType)}</span>
      <span>${column.nullable ? '是' : '否'}</span>
      <span class="column-default">${escapeHtml(column.defaultValue ?? '—')}</span>
      <span class="column-marks">${column.primaryKey ? '<b class="tag pk">PK</b>' : ''}${column.autoIncrement ? '<b class="tag auto">AUTO</b>' : ''}</span>
    </div>`).join('')}
  </div>`;
}

function renderGeneratorModal(modal) {
  const data = modal.data || {};
  const table = data.tableInfo;
  if (!table) return '<div class="modal-loading"><span class="spinner"></span><p>读取表信息…</p></div>';
  const hasPk = table.primaryKeys?.length === 1;
  const preview = data.preview?.endpoints || [];
  return `<div class="modal-intro">为 <code>${escapeHtml(table.schema ? table.schema + '.' + table.name : table.name)}</code> 生成标准 REST 接口。${data.readOnly ? '<b class="danger-text">该数据源已启用只读模式，只能生成列表和详情接口。</b>' : !hasPk ? '<b class="danger-text">该表没有单列主键，只能生成列表和新增。</b>' : ''}</div>
  <div class="form-grid">
    <label class="field field-span-2"><span>路径前缀</span><input id="crud-path-base" value="${escapeHtml(data.pathBase || '/')}" placeholder="/users"></label>
    <div class="field field-span-2"><span>生成方法</span><div class="method-checks">
      ${[
        ['list', '列表 GET'],
        ['get', '详情 GET'],
        ['create', '新增 POST'],
        ['update', '更新 PUT'],
        ['delete', '删除 DELETE']
      ].map(([key, label]) => {
        const needsPk = ['get', 'update', 'delete'].includes(key);
        const disabled = (needsPk && !hasPk) || (data.readOnly && ['create', 'update', 'delete'].includes(key));
        const checked = (data.methods || []).includes(key) && !disabled;
        return `<label class="method-check ${disabled ? 'disabled' : ''}"><input type="checkbox" name="crud-method" value="${key}" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}><span>${label}</span></label>`;
      }).join('')}
    </div></div>
  </div>
  ${data.error ? `<div class="notice notice-warn"><div><strong>无法生成</strong><p>${escapeHtml(data.error)}</p></div></div>` : ''}
  <div class="preview-head"><span class="eyebrow">PREVIEW</span><button class="tiny-button" data-action="crud-preview">刷新预览</button></div>
  <div class="crud-preview">
    ${data.loading ? '<div class="modal-loading small"><span class="spinner"></span></div>' : preview.length ? preview.map((endpoint) => `<div class="crud-preview-row"><span class="method-badge mini ${methodClass(endpoint.method)}">${escapeHtml(endpoint.method)}</span><code>${escapeHtml(endpoint.path)}</code><span>${escapeHtml(endpoint.name)}</span></div>`).join('') : '<p class="muted">点击“刷新预览”查看将要创建的接口。</p>'}
  </div>`;
}

function renderTokenModal(modal) {
  const token = modal.data?.token || '';
  return `<div class="modal-intro">仅当服务配置了 <code>ADMIN_TOKEN</code> 时需要。令牌只保存在当前浏览器 localStorage，不会写入项目文件。</div>
  <label class="field"><span>管理访问令牌</span><input id="admin-token-input" type="password" value="${escapeHtml(token)}" placeholder="粘贴 ADMIN_TOKEN"></label>
  <div class="notice notice-info"><div><strong>本机免令牌</strong><p>未配置 ADMIN_TOKEN 时，服务默认只允许 127.0.0.1 访问管理接口。</p></div></div>`;
}

function renderConfirmModal(modal) {
  return `<div class="confirm-body"><span class="state-icon small">${ICONS.activity}</span><p>${escapeHtml(modal.message || '确定执行此操作吗？')}</p></div>`;
}
