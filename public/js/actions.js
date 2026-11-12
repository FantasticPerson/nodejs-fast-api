import { api, ApiError, getAdminToken, setAdminToken } from './api.js';
import { cloneEditor, createBlankEditor, state } from './state.js';
import {
  buildCurl,
  copyText,
  errorMessage,
  runtimeUrl,
  setBusy,
  showToast,
  slugify
} from './ui.js';

export function createActions({ render, refreshData, boot }) {
  async function handleClick(event) {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    if (target.disabled) return;

    try {
      switch (action) {
        case 'modal-close':
          state.modal = null;
          render();
          break;
        case 'nav': {
          state.view = target.dataset.view || 'apis';
          if (state.view !== 'editor') state.editor = null;
          render();
          break;
        }
        case 'refresh':
        case 'logs-refresh':
          await refreshData();
          showToast('已刷新');
          break;
        case 'retry-boot':
          await boot();
          break;
        case 'toggle-theme':
          state.theme = state.theme === 'dark' ? 'light' : 'dark';
          document.documentElement.dataset.theme = state.theme;
          localStorage.setItem('node-magic-theme', state.theme);
          render();
          break;
        case 'token-open':
          state.modal = {
            type: 'token',
            title: '设置访问令牌',
            eyebrow: 'ACCESS',
            size: 'narrow',
            data: { token: getAdminToken() }
          };
          render();
          break;
        case 'token-save': {
          const input = document.getElementById('admin-token-input');
          setAdminToken(input?.value || '');
          state.modal = null;
          await boot();
          if (state.authError) showToast(state.authError, 'error');
          else showToast('访问令牌已保存', 'success');
          break;
        }
        case 'api-new':
          state.editor = createBlankEditor();
          state.view = 'editor';
          state.modal = null;
          render();
          break;
        case 'api-edit': {
          const endpoint = state.endpoints.find((item) => item.id === target.dataset.id);
          if (!endpoint) return;
          state.editor = cloneEditor(endpoint);
          state.view = 'editor';
          render();
          break;
        }
        case 'api-toggle': {
          const endpoint = state.endpoints.find((item) => item.id === target.dataset.id);
          if (!endpoint) return;
          setBusy(target, true, '…');
          await api.updateEndpoint(endpoint.id, { ...endpoint, enabled: !endpoint.enabled });
          await refreshData();
          showToast(endpoint.enabled ? '接口已停用' : '接口已启用');
          break;
        }
        case 'api-copy-curl': {
          const endpoint = state.endpoints.find((item) => item.id === target.dataset.id);
          if (endpoint) await copyText(buildCurl(endpoint));
          showToast('cURL 已复制');
          break;
        }
        case 'editor-back':
          state.editor = null;
          state.view = 'apis';
          render();
          break;
        case 'editor-save':
          await saveEditor(target);
          break;
        case 'editor-delete':
          openConfirm({
            title: '删除接口',
            message: `确定删除「${state.editor?.name || '未命名接口'}」吗？删除后运行时立即失效。`,
            confirmAction: 'delete-endpoint',
            id: state.editor?.id,
            confirmLabel: '删除接口',
            danger: true
          });
          break;
        case 'editor-insert': {
          insertSnippet(target.dataset.snippet || '');
          break;
        }
        case 'editor-extract-params':
          extractParams();
          break;
        case 'editor-add-param':
          addParam();
          break;
        case 'editor-remove-param': {
          const index = Number(target.dataset.index);
          state.editor.params.splice(index, 1);
          render();
          break;
        }
        case 'editor-render':
          await renderEditorSql(target);
          break;
        case 'editor-run':
          await runEditor(target);
          break;
        case 'editor-copy-render':
          if (state.editor?.renderResponse) await copyText(JSON.stringify(state.editor.renderResponse, null, 2));
          showToast('SQL 预览已复制');
          break;
        case 'editor-copy-result':
          if (state.editor?.testResponse) await copyText(JSON.stringify(state.editor.testResponse, null, 2));
          showToast('接口返回已复制');
          break;
        case 'editor-copy-url':
          await copyText(runtimeUrl(state.editor?.path || '/'));
          showToast('接口地址已复制');
          break;
        case 'editor-copy-curl':
          await copyText(buildCurl(state.editor));
          showToast('cURL 已复制');
          break;
        case 'ds-new':
          state.modal = {
            type: 'datasource',
            title: '添加数据源',
            eyebrow: 'CONNECTION',
            data: { datasource: {} }
          };
          render();
          break;
        case 'ds-edit': {
          const datasource = state.datasources.find((item) => item.id === target.dataset.id);
          if (!datasource) return;
          state.modal = {
            type: 'datasource',
            title: '编辑数据源',
            eyebrow: 'CONNECTION',
            data: { datasource }
          };
          render();
          break;
        }
        case 'ds-save':
          await saveDatasource(target);
          break;
        case 'ds-test-draft':
          await testDraftDatasource(target);
          break;
        case 'ds-test': {
          setBusy(target, true, '测试中…');
          const result = await api.testDatasource(target.dataset.id);
          showToast(connectionMessage(result), 'success');
          setBusy(target, false);
          break;
        }
        case 'ds-delete': {
          const datasource = state.datasources.find((item) => item.id === target.dataset.id);
          if (!datasource) return;
          openConfirm({
            title: '删除数据源',
            message: `确定删除数据源「${datasource.name}」吗？如果仍有接口引用它，服务会拒绝删除。`,
            confirmAction: 'delete-datasource',
            id: datasource.id,
            confirmLabel: '删除数据源',
            danger: true
          });
          break;
        }
        case 'ds-tables':
          await openTableBrowser(target.dataset.id);
          break;
        case 'table-select':
          await selectTable(target.dataset.table);
          break;
        case 'crud-open':
          openGenerator();
          break;
        case 'crud-preview':
          await previewCrud(target);
          break;
        case 'crud-generate':
          await generateCrud(target);
          break;
        case 'logs-clear':
          openConfirm({
            title: '清空调用日志',
            message: '确定清空当前内存中的所有调用日志吗？该操作不可恢复。',
            confirmAction: 'clear-logs',
            confirmLabel: '清空日志'
          });
          break;
        case 'copy-openapi-url':
          await copyText(api.openApiSpecUrl());
          showToast('OpenAPI 地址已复制');
          break;
        case 'doc-copy-curl': {
          const endpoint = state.endpoints.find((item) => item.id === target.dataset.id);
          if (endpoint) await copyText(buildCurl(endpoint));
          showToast('cURL 已复制');
          break;
        }
        case 'confirm-accept':
          await confirmAccept(target);
          break;
        default:
          break;
      }
    } catch (error) {
      setBusy(target, false);
      if (error instanceof ApiError && error.status === 401) {
        state.authError = error.message;
        render();
      }
      showToast(errorMessage(error), 'error');
    }
  }

  function handleInput(event) {
    const target = event.target;
    if (target.id === 'api-search') {
      state.apiSearch = target.value;
      filterApiRows(target.value);
      return;
    }
    if (target.id === 'table-search') {
      filterTableRows(target.value);
      return;
    }
    if (target.type === 'checkbox' || target.tagName === 'SELECT') return;
    if (target.dataset.paramIndex !== undefined) {
      syncParamField(target);
      return;
    }
    if (target.dataset.role === 'test-values') {
      state.editor.testValues = target.value;
      return;
    }
    if (target.dataset.field && state.editor) {
      syncEditorField(target);
      if (target.dataset.field === 'sql') syncGutter(target);
    }
  }

  function handleChange(event) {
    const target = event.target;
    if (target.dataset.paramIndex !== undefined) {
      syncParamField(target);
      if (target.dataset.paramRerender !== undefined) render();
      return;
    }
    if (target.dataset.field && state.editor) {
      syncEditorField(target);
      if (target.dataset.rerender !== undefined) render();
    }
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && state.modal) {
      state.modal = null;
      render();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && state.editor && !state.modal) {
      event.preventDefault();
      runEditor(null).catch((error) => showToast(errorMessage(error), 'error'));
    }
  }

  async function saveEditor(button) {
    const editor = state.editor;
    if (!editor) return;
    if (!editor.datasourceId) throw new Error('请先选择数据源');
    if (!String(editor.path || '').trim()) throw new Error('接口路径不能为空');
    if (!String(editor.sql || '').trim()) throw new Error('SQL 不能为空');
    setBusy(button, true, '保存中…');
    const payload = editorPayload(editor);
    if (editor.id) await api.updateEndpoint(editor.id, payload);
    else await api.createEndpoint(payload);
    state.editor = null;
    state.view = 'apis';
    await refreshData();
    showToast(editor.id ? '接口已保存并生效' : '接口已创建并生效', 'success');
  }

  function editorPayload(editor) {
    return {
      name: editor.name,
      method: editor.method,
      path: editor.path,
      datasourceId: editor.datasourceId,
      sql: editor.sql,
      description: editor.description,
      group: editor.group,
      enabled: editor.enabled,
      allowRawSql: editor.allowRawSql,
      params: editor.params.map((param) => ({
        name: param.name,
        in: param.in,
        type: param.type,
        required: Boolean(param.required),
        defaultValue: param.defaultValue === '' ? null : param.defaultValue,
        description: param.description || ''
      })),
      pagination: {
        enabled: Boolean(editor.pagination?.enabled),
        maxPageSize: Number(editor.pagination?.maxPageSize) || 100
      },
      responseMode: editor.responseMode
    };
  }

  async function renderEditorSql(button) {
    const editor = state.editor;
    if (!editor) return;
    const values = readTestValues();
    setBusy(button, true, '生成中…');
    editor.renderResponse = await api.renderSql(previewPayload(editor, values));
    setBusy(button, false);
    render();
  }

  async function runEditor(button) {
    const editor = state.editor;
    if (!editor) return;
    const values = readTestValues();
    setBusy(button, true, '运行中…');
    editor.testResponse = await api.runSql(previewPayload(editor, values));
    setBusy(button, false);
    render();
  }

  function previewPayload(editor, values) {
    const merged = { ...values };
    if (!('page' in merged)) merged.page = Number(editor.testPage) || 1;
    if (!('pageSize' in merged)) merged.pageSize = Number(editor.testPageSize) || 20;
    return {
      datasourceId: editor.datasourceId,
      sql: editor.sql,
      params: editor.params,
      allowRawSql: editor.allowRawSql,
      pagination: { enabled: Boolean(editor.pagination?.enabled) },
      values: merged
    };
  }

  function readTestValues() {
    const area = document.getElementById('test-values');
    const text = area?.value || state.editor?.testValues || '{}';
    if (!text.trim()) return {};
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('测试参数不是有效 JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('测试参数必须是 JSON 对象');
    }
    return parsed;
  }

  function insertSnippet(snippet) {
    const area = document.getElementById('sql-input');
    if (!area || !state.editor) return;
    const start = area.selectionStart || 0;
    const end = area.selectionEnd || 0;
    const value = area.value;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    state.editor.sql = next;
    area.value = next;
    area.focus();
    area.selectionStart = area.selectionEnd = start + snippet.length;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function extractParams() {
    if (!state.editor) return;
    const sql = state.editor.sql || '';
    const loopVars = new Set(
      [...sql.matchAll(/<foreach[^>]*\bitem\s*=\s*["']([^"']+)["']/gi)].map((match) => match[1])
    );
    const found = new Set();
    for (const match of sql.matchAll(/#\{([^}]*)\}|\$\{([^}]*)\}/g)) {
      const expression = String(match[1] ?? match[2] ?? '').trim();
      const root = expression.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
      if (root && !loopVars.has(root)) found.add(root);
    }
    let added = 0;
    for (const name of found) {
      if (state.editor.params.some((param) => param.name === name)) continue;
      const inPath = new RegExp(`/:${name}(?:/|$)`).test(state.editor.path || '');
      state.editor.params.push({
        name,
        in: inPath ? 'path' : 'query',
        type: 'string',
        required: inPath,
        defaultValue: '',
        description: ''
      });
      added += 1;
    }
    render();
    showToast(added ? `已提取 ${added} 个参数` : '没有发现新的参数');
  }

  function addParam() {
    if (!state.editor) return;
    let index = 1;
    while (state.editor.params.some((param) => param.name === `param${index}`)) index += 1;
    state.editor.params.push({
      name: `param${index}`,
      in: 'query',
      type: 'string',
      required: false,
      defaultValue: '',
      description: ''
    });
    render();
  }

  async function saveDatasource(button) {
    const form = document.getElementById('datasource-form');
    if (!form) return;
    const input = formObject(form);
    const existingId = state.modal?.data?.datasource?.id || null;
    setBusy(button, true, '保存中…');
    const datasource = existingId
      ? await api.updateDatasource(existingId, input)
      : await api.createDatasource(input);
    state.modal = null;
    await refreshData();
    showToast(`数据源「${datasource.name}」已保存`, 'success');
  }

  async function testDraftDatasource(button) {
    const form = document.getElementById('datasource-form');
    if (!form) return;
    const input = formObject(form);
    const existingId = state.modal?.data?.datasource?.id;
    if (existingId) input.id = existingId;
    const resultBox = document.getElementById('ds-test-result');
    setBusy(button, true, '测试中…');
    try {
      const result = await api.testDatasourceDraft(input);
      if (resultBox) {
        resultBox.classList.add('success');
        resultBox.textContent = connectionMessage(result);
      }
      showToast('连接成功', 'success');
    } catch (error) {
      if (resultBox) {
        resultBox.classList.remove('success');
        resultBox.classList.add('failed');
        resultBox.textContent = error.message;
      }
      throw error;
    } finally {
      setBusy(button, false);
    }
  }

  async function openTableBrowser(datasourceId) {
    const datasource = state.datasources.find((item) => item.id === datasourceId);
    state.modal = {
      type: 'tables',
      title: `浏览表 · ${datasource?.name || '数据源'}`,
      eyebrow: 'SCHEMA',
      size: 'wide',
      data: { dsId: datasourceId, dsName: datasource?.name || '', tables: [], loading: true }
    };
    render();
    try {
      const tables = await api.listTables(datasourceId);
      if (!state.modal || state.modal.type !== 'tables') return;
      state.modal.data.tables = tables;
      state.modal.data.loading = false;
    } catch (error) {
      if (!state.modal || state.modal.type !== 'tables') return;
      state.modal.data.loading = false;
      state.modal.data.error = error.message;
    }
    render();
  }

  async function selectTable(tableName) {
    if (!state.modal || state.modal.type !== 'tables') return;
    state.modal.data.selectedTable = tableName;
    state.modal.data.columnsLoading = true;
    state.modal.data.tableInfo = null;
    render();
    try {
      const table = await api.getTableInfo(state.modal.data.dsId, tableName);
      if (!state.modal || state.modal.type !== 'tables' || state.modal.data.selectedTable !== tableName) return;
      state.modal.data.tableInfo = table;
    } catch (error) {
      if (!state.modal || state.modal.type !== 'tables' || state.modal.data.selectedTable !== tableName) return;
      state.modal.data.error = error.message;
    }
    if (!state.modal || state.modal.type !== 'tables') return;
    state.modal.data.columnsLoading = false;
    render();
  }

  function openGenerator() {
    const table = state.modal?.data?.tableInfo;
    if (!table) return;
    const hasPk = table.primaryKeys?.length === 1;
    state.modal = {
      type: 'generator',
      title: `生成 CRUD · ${table.name}`,
      eyebrow: 'GENERATOR',
      size: 'wide',
      data: {
        dsId: state.modal.data.dsId,
        tableInfo: table,
        pathBase: `/${slugify(table.name)}`,
        methods: hasPk ? ['list', 'get', 'create', 'update', 'delete'] : ['list', 'create'],
        preview: null,
        loading: true,
        error: null
      }
    };
    render();
    previewGenerator().catch((error) => {
      if (state.modal?.type === 'generator') {
        state.modal.data.loading = false;
        state.modal.data.error = error.message;
        render();
      }
    });
  }

  async function previewCrud(button) {
    if (!state.modal || state.modal.type !== 'generator') return;
    setBusy(button, true, '生成中…');
    state.modal.data.loading = true;
    state.modal.data.error = null;
    try {
      await previewGenerator();
    } catch (error) {
      if (state.modal?.type === 'generator') {
        state.modal.data.loading = false;
        state.modal.data.error = error.message;
        render();
      }
      throw error;
    }
    setBusy(button, false);
    render();
  }

  async function previewGenerator() {
    const data = state.modal?.data;
    if (!data) return;
    const options = readGeneratorOptions();
    data.pathBase = options.pathBase;
    data.methods = options.methods;
    const result = await api.previewCrud(data.dsId, data.tableInfo.name, options);
    if (!state.modal || state.modal.type !== 'generator') return;
    data.preview = result;
    data.loading = false;
    data.error = null;
    render();
  }

  async function generateCrud(button) {
    if (!state.modal || state.modal.type !== 'generator') return;
    const data = state.modal.data;
    const options = readGeneratorOptions();
    if (!options.methods.length) throw new Error('至少选择一种生成方法');
    setBusy(button, true, '生成中…');
    const result = await api.generateCrud(data.dsId, data.tableInfo.name, options);
    state.modal = null;
    state.view = 'apis';
    await refreshData();
    showToast(`已生成 ${result.endpoints.length} 个接口`, 'success');
  }

  function readGeneratorOptions() {
    const pathBase = document.getElementById('crud-path-base')?.value?.trim() || '/';
    const methods = [...document.querySelectorAll('input[name="crud-method"]:checked')].map((input) => input.value);
    return { pathBase, methods };
  }

  async function confirmAccept(button) {
    const modal = state.modal;
    if (!modal || modal.type !== 'confirm') return;
    const action = modal.data?.confirmAction;
    setBusy(button, true, '处理中…');
    if (action === 'delete-endpoint') {
      await api.deleteEndpoint(modal.data.id);
      state.modal = null;
      state.editor = null;
      state.view = 'apis';
      await refreshData();
      showToast('接口已删除');
      return;
    }
    if (action === 'delete-datasource') {
      await api.deleteDatasource(modal.data.id);
      state.modal = null;
      await refreshData();
      showToast('数据源已删除');
      return;
    }
    if (action === 'clear-logs') {
      await api.clearLogs();
      state.modal = null;
      await refreshData();
      showToast('日志已清空');
      return;
    }
    throw new Error('未知的确认操作');
  }

  function openConfirm({ title, message, confirmAction, id, confirmLabel, danger }) {
    state.modal = {
      type: 'confirm',
      title,
      eyebrow: 'CONFIRM',
      size: 'narrow',
      message,
      confirmAction,
      confirmLabel,
      danger: Boolean(danger),
      data: { confirmAction, id }
    };
    render();
  }

  function syncEditorField(target) {
    if (!state.editor) return;
    const field = target.dataset.field;
    if (field === 'pageEnabled') {
      state.editor.pagination.enabled = target.checked;
    } else if (field === 'pageMax') {
      state.editor.pagination.maxPageSize = Number(target.value) || 100;
    } else if (field === 'allowRawSql' || field === 'enabled') {
      state.editor[field] = target.checked;
    } else if (field === 'testPage' || field === 'testPageSize') {
      state.editor[field] = Number(target.value) || 1;
    } else if (field === 'method' || field === 'datasourceId' || field === 'responseMode') {
      state.editor[field] = target.value;
    } else {
      state.editor[field] = target.value;
    }
  }

  function syncParamField(target) {
    const index = Number(target.dataset.paramIndex);
    const field = target.dataset.paramField;
    const param = state.editor?.params?.[index];
    if (!param || !field) return;
    if (field === 'required') param.required = target.checked;
    else param[field] = target.value;
  }

  function filterApiRows(query) {
    const needle = String(query || '').trim().toLowerCase();
    for (const row of document.querySelectorAll('.endpoint-row[data-search]')) {
      row.classList.toggle('is-filtered', Boolean(needle) && !row.dataset.search.includes(needle));
    }
  }

  function filterTableRows(query) {
    const needle = String(query || '').trim().toLowerCase();
    for (const row of document.querySelectorAll('.table-item[data-table-name]')) {
      row.classList.toggle('is-filtered', Boolean(needle) && !row.dataset.tableName.includes(needle));
    }
  }

  function syncGutter(textarea) {
    const gutter = document.getElementById('sql-gutter');
    if (!gutter) return;
    const count = Math.max(1, textarea.value.split('\n').length);
    gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
    gutter.scrollTop = textarea.scrollTop;
  }

  return { handleClick, handleInput, handleChange, handleKeydown, syncGutter };
}

function formObject(form) {
  const data = new FormData(form);
  const output = {};
  for (const [key, value] of data.entries()) output[key] = String(value);
  return output;
}

function connectionMessage(result) {
  const latency = result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : '';
  if (result.type === 'mysql') return `MySQL 连接成功 · ${result.version || 'MySQL'}${latency}`;
  return `Oracle 连接成功${result.currentUser ? ` · ${result.currentUser}` : ''}${latency}`;
}
