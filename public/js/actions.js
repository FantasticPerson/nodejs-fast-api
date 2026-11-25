import { api, ApiError, getAdminToken, setAdminToken } from './api.js';
import { getScriptCompletions } from './script-completion.js';
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
  let completionState = null;
  let completionElement = null;
  let lastScriptEditor = null;
  let lastScriptCaret = 0;

  async function handleClick(event) {
    const outsideCompletion = !event.target.closest('#script-completion-menu');
    const target = event.target.closest('[data-action]');
    if (!target) {
      if (outsideCompletion) closeScriptCompletion();
      return;
    }
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
        case 'api-group':
          state.apiGroup = target.dataset.group || '';
          render();
          break;
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
        case 'editor-versions':
          await openVersions('endpoint', state.editor?.id);
          break;
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
        case 'script-insert-call':
          insertScriptCall(target.dataset.snippet || '', target.dataset.caretOffset);
          break;
        case 'script-complete-open':
          openScriptCompletion();
          break;
        case 'script-complete-pick':
          pickScriptCompletion(Number(target.dataset.completionIndex));
          break;
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
        case 'script-new':
          state.modal = {
            type: 'script-library',
            title: '新建共享脚本',
            eyebrow: 'SHARED SCRIPT',
            size: 'wide',
            data: { script: { enabled: true }, existing: false }
          };
          render();
          break;
        case 'script-edit': {
          const script = state.scripts.find((item) => item.name === target.dataset.name);
          if (!script) return;
          state.modal = {
            type: 'script-library',
            title: `编辑共享脚本 · ${script.name}`,
            eyebrow: 'SHARED SCRIPT',
            size: 'wide',
            data: { script, existing: true }
          };
          render();
          break;
        }
        case 'script-save':
          await saveScriptLibrary(target);
          break;
        case 'script-versions':
          await openVersions('script', target.dataset.name);
          break;
        case 'script-delete':
          openConfirm({
            title: '删除共享脚本',
            message: `确定删除共享脚本「${target.dataset.name}」吗？引用它的接口脚本会在运行时失败。`,
            confirmAction: 'delete-script',
            id: target.dataset.name,
            confirmLabel: '删除共享脚本',
            danger: true
          });
          break;
        case 'version-restore':
          await restoreVersion(target);
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
      if (target.dataset.field === 'sql') {
        closeScriptCompletion();
        syncGutter(target);
      }
      if (target.dataset.field === 'scriptCode') {
        rememberScriptCaret(target);
        syncGutter(target);
        updateScriptCompletion(target, false);
      }
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
    if (completionState && !state.modal) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeScriptCompletion();
        return;
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        moveScriptCompletion(event.key === 'ArrowDown' ? 1 : -1);
        return;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault();
        pickScriptCompletion(completionState.index);
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown'].includes(event.key)) {
        closeScriptCompletion();
      }
    }
    const manualTrigger =
      (event.ctrlKey && (event.code === 'Space' || event.key === ' ')) ||
      (event.altKey && event.key === '/');
    if (manualTrigger && document.activeElement?.id === 'script-input' && state.editor?.engine === 'script') {
      event.preventDefault();
      updateScriptCompletion(document.activeElement, true);
      return;
    }
    if (event.key === 'Escape' && state.modal) {
      state.modal = null;
      render();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && state.editor && !state.modal) {
      event.preventDefault();
      closeScriptCompletion();
      runEditor(null).catch((error) => showToast(errorMessage(error), 'error'));
    }
  }

  async function saveEditor(button) {
    const editor = state.editor;
    if (!editor) return;
    if (!editor.datasourceId) throw new Error('请先选择数据源');
    if (!String(editor.path || '').trim()) throw new Error('接口路径不能为空');
    if (editor.engine === 'script') {
      if (!String(editor.scriptCode || '').trim()) throw new Error('脚本代码不能为空');
    } else if (!String(editor.sql || '').trim()) {
      throw new Error('SQL 不能为空');
    }
    setBusy(button, true, '保存中…');
    const payload = editorPayload(editor);
    if (editor.id) await api.updateEndpoint(editor.id, payload);
    else await api.createEndpoint(payload);
    state.apiGroup = String(editor.group || '').trim();
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
      engine: editor.engine || 'sql',
      scriptCode: editor.scriptCode || '',
      allowHttp: Boolean(editor.allowHttp),
      description: editor.description,
      group: editor.group,
      enabled: editor.enabled,
      allowRawSql: editor.allowRawSql,
      timeoutMs: Number(editor.timeoutMs) || 0,
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
    if (editor.engine === 'script') throw new Error('脚本接口没有 SQL 预览');
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
    const result = await api.runSql(previewPayload(editor, values));
    if (editor.engine === 'script') {
      editor.testResponse = result?.result ?? null;
      editor.scriptLogs = result?.logs || [];
    } else {
      editor.testResponse = result;
      editor.scriptLogs = [];
    }
    setBusy(button, false);
    render();
  }

  function previewPayload(editor, values) {
    const merged = { ...values };
    if (!('page' in merged)) merged.page = Number(editor.testPage) || 1;
    if (!('pageSize' in merged)) merged.pageSize = Number(editor.testPageSize) || 20;
    return {
      datasourceId: editor.datasourceId,
      engine: editor.engine || 'sql',
      sql: editor.sql,
      scriptCode: editor.scriptCode || '',
      allowHttp: Boolean(editor.allowHttp),
      params: editor.params,
      allowRawSql: editor.allowRawSql,
      timeoutMs: Number(editor.timeoutMs) || 0,
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
    const area = document.getElementById(`${
      state.editor?.engine === 'script' ? 'script-input' : 'sql-input'
    }`);
    if (!area || !state.editor) return;
    const start = area.selectionStart || 0;
    const end = area.selectionEnd || 0;
    const value = area.value;
    const next = `${value.slice(0, start)}${snippet}${value.slice(end)}`;
    const field = state.editor.engine === 'script' ? 'scriptCode' : 'sql';
    state.editor[field] = next;
    area.value = next;
    area.focus();
    area.selectionStart = area.selectionEnd = start + snippet.length;
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function rememberScriptCaret(area) {
    if (!state.editor || !area) return;
    lastScriptEditor = state.editor;
    lastScriptCaret = Math.max(0, Math.min(area.selectionStart || 0, area.value.length));
  }

  function closeScriptCompletion() {
    completionState = null;
    if (completionElement) {
      completionElement.remove();
      completionElement = null;
    }
  }

  function openScriptCompletion() {
    const area = document.getElementById('script-input');
    if (!area || !state.editor || state.editor.engine !== 'script') return;
    const caret = lastScriptEditor === state.editor
      ? Math.max(0, Math.min(lastScriptCaret, area.value.length))
      : area.value.length;
    area.focus({ preventScroll: true });
    area.setSelectionRange(caret, caret);
    updateScriptCompletion(area, true);
  }

  function updateScriptCompletion(area, manual) {
    if (!area || !state.editor || state.editor.engine !== 'script') {
      closeScriptCompletion();
      return;
    }
    rememberScriptCaret(area);
    if (area.selectionStart !== area.selectionEnd) {
      closeScriptCompletion();
      return;
    }
    const result = getScriptCompletions({
      source: area.value,
      caret: area.selectionStart,
      params: state.editor.params || [],
      libraries: state.scripts || [],
      plugins: state.config.plugins || [],
      manual: Boolean(manual)
    });
    if (!result) {
      closeScriptCompletion();
      if (manual) showToast('当前位置没有可用的脚本提示');
      return;
    }
    completionState = { ...result, index: 0, textareaId: area.id };
    renderScriptCompletion();
  }

  function renderScriptCompletion() {
    if (!completionState) return;
    if (completionElement) {
      completionElement.remove();
      completionElement = null;
    }
    const menu = document.createElement('div');
    menu.id = 'script-completion-menu';
    menu.className = 'completion-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', '脚本补全');
    const heading = document.createElement('div');
    heading.className = 'completion-heading';
    heading.textContent = completionState.chain.length
      ? `${completionState.chain.join('.')}.${completionState.token}`
      : '脚本 API';
    menu.appendChild(heading);
    const kindLabels = {
      object: 'obj',
      property: 'prop',
      method: 'fn',
      parameter: 'param',
      keyword: 'kw',
      library: 'lib',
      plugin: 'plug'
    };
    completionState.options.forEach((option, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = `completion-item${index === completionState.index ? ' active' : ''}`;
      item.dataset.action = 'script-complete-pick';
      item.dataset.completionIndex = String(index);
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', index === completionState.index ? 'true' : 'false');
      const kind = document.createElement('span');
      kind.className = `completion-kind completion-kind-${option.kind}`;
      kind.textContent = kindLabels[option.kind] || 'api';
      const main = document.createElement('span');
      main.className = 'completion-main';
      const label = document.createElement('span');
      label.className = 'completion-label';
      label.textContent = option.label;
      main.appendChild(label);
      if (option.detail) {
        const detail = document.createElement('span');
        detail.className = 'completion-detail';
        detail.textContent = option.detail;
        main.appendChild(detail);
      }
      item.append(kind, main);
      if (option.description) {
        const description = document.createElement('span');
        description.className = 'completion-description';
        description.textContent = option.description;
        item.appendChild(description);
      }
      menu.appendChild(item);
    });
    const foot = document.createElement('div');
    foot.className = 'completion-foot';
    foot.textContent = '↑↓ 选择 · Enter/Tab 插入 · Esc 关闭';
    menu.appendChild(foot);
    document.body.appendChild(menu);
    completionElement = menu;
    positionScriptCompletion();
    scrollActiveCompletionIntoView();
  }

  function positionScriptCompletion() {
    if (!completionState || !completionElement) return;
    const area = document.getElementById(completionState.textareaId);
    if (!area) {
      closeScriptCompletion();
      return;
    }
    const point = caretCoordinates(area, completionState.from);
    const lineHeight = Number.parseFloat(getComputedStyle(area).lineHeight) || 20;
    let left = point.left;
    let top = point.top + lineHeight + 4;
    if (top + completionElement.offsetHeight > window.innerHeight - 8) {
      top = point.top - completionElement.offsetHeight - 4;
    }
    left = Math.max(8, Math.min(left, window.innerWidth - completionElement.offsetWidth - 8));
    top = Math.max(8, top);
    completionElement.style.left = `${left}px`;
    completionElement.style.top = `${top}px`;
  }

  function moveScriptCompletion(direction) {
    if (!completionState || !completionState.options.length) return;
    const count = completionState.options.length;
    completionState.index = (completionState.index + direction + count) % count;
    for (const item of completionElement?.querySelectorAll('[data-completion-index]') || []) {
      const active = Number(item.dataset.completionIndex) === completionState.index;
      item.classList.toggle('active', active);
      item.setAttribute('aria-selected', active ? 'true' : 'false');
    }
    scrollActiveCompletionIntoView();
  }

  function scrollActiveCompletionIntoView() {
    if (!completionElement) return;
    const active = completionElement.querySelector('.completion-item.active');
    if (!active) return;
    if (active.offsetTop < completionElement.scrollTop) {
      completionElement.scrollTop = active.offsetTop;
    } else if (active.offsetTop + active.offsetHeight > completionElement.scrollTop + completionElement.clientHeight) {
      completionElement.scrollTop = active.offsetTop + active.offsetHeight - completionElement.clientHeight;
    }
  }

  function pickScriptCompletion(index) {
    if (!completionState) return;
    const option = completionState.options[index];
    const area = document.getElementById(completionState.textareaId);
    if (!option || !area) {
      closeScriptCompletion();
      return;
    }
    let text = option.insertText || option.label;
    let caretOffset = text.length;
    if (option.cursorOffset !== undefined) {
      caretOffset = Number(option.cursorOffset);
    } else if (option.call) {
      if (area.value[completionState.to] === '(') {
        caretOffset = text.length + 1;
      } else {
        text = `${text}()`;
        caretOffset = text.length - 1;
      }
    }
    replaceScriptText(
      area,
      completionState.from,
      completionState.to,
      text,
      completionState.from + caretOffset
    );
  }

  function insertScriptCall(snippet, caretOffset) {
    const area = document.getElementById('script-input');
    if (!area || !state.editor || state.editor.engine !== 'script') return;
    let from = area.value.length;
    let to = from;
    if (document.activeElement === area) {
      from = area.selectionStart || 0;
      to = area.selectionEnd || from;
    } else if (lastScriptEditor === state.editor) {
      from = Math.max(0, Math.min(lastScriptCaret, area.value.length));
      to = from;
    }
    const offset = caretOffset === undefined || caretOffset === ''
      ? snippet.length
      : Math.max(0, Math.min(Number(caretOffset), snippet.length));
    replaceScriptText(area, from, to, snippet, from + offset);
  }

  function replaceScriptText(area, from, to, text, caret) {
    if (!state.editor) return;
    closeScriptCompletion();
    const value = area.value;
    const next = `${value.slice(0, from)}${text}${value.slice(to)}`;
    state.editor.scriptCode = next;
    area.value = next;
    area.focus({ preventScroll: true });
    area.setSelectionRange(caret, caret);
    rememberScriptCaret(area);
    area.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function caretCoordinates(area, position) {
    const computed = getComputedStyle(area);
    const mirror = document.createElement('div');
    const properties = [
      'boxSizing', 'overflowX', 'overflowY', 'borderStyle', 'borderTopWidth',
      'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'paddingTop',
      'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant',
      'fontWeight', 'fontStretch', 'fontSize', 'fontSizeAdjust', 'lineHeight',
      'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'textDecoration',
      'letterSpacing', 'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap',
      'wordBreak', 'overflowWrap'
    ];
    for (const property of properties) mirror.style[property] = computed[property];
    mirror.style.position = 'absolute';
    mirror.style.visibility = 'hidden';
    mirror.style.top = '-9999px';
    mirror.style.left = '0';
    mirror.style.width = `${area.clientWidth}px`;
    mirror.style.height = 'auto';
    mirror.style.whiteSpace = 'pre-wrap';
    mirror.style.overflowWrap = 'break-word';
    const before = area.value.slice(0, position);
    const marker = document.createElement('span');
    marker.textContent = '\u200b';
    mirror.textContent = before;
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const mirrorRect = mirror.getBoundingClientRect();
    const markerRect = marker.getBoundingClientRect();
    const areaRect = area.getBoundingClientRect();
    const point = {
      left: areaRect.left + markerRect.left - mirrorRect.left - area.scrollLeft,
      top: areaRect.top + markerRect.top - mirrorRect.top - area.scrollTop
    };
    mirror.remove();
    return point;
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

  async function saveScriptLibrary(button) {
    const form = document.getElementById('script-library-form');
    if (!form) return;
    const input = formObject(form);
    input.enabled = input.enabled !== 'false';
    const existing = state.modal?.data?.existing;
    const name = state.modal?.data?.script?.name;
    setBusy(button, true, '保存中…');
    const script = existing
      ? await api.updateScript(name, input)
      : await api.createScript(input);
    state.modal = null;
    await refreshData();
    showToast(`共享脚本「${script.name}」已保存`, 'success');
  }

  async function openVersions(kind, target) {
    if (!target) throw new Error('缺少版本对象');
    const versions =
      kind === 'endpoint'
        ? await api.listEndpointVersions(target)
        : await api.listScriptVersions(target);
    state.modal = {
      type: 'versions',
      title: kind === 'endpoint' ? '接口历史版本' : '共享脚本历史版本',
      eyebrow: 'VERSIONS',
      size: 'wide',
      data: { kind, target, versions }
    };
    render();
  }

  async function restoreVersion(button) {
    const kind = button.dataset.kind;
    const target = button.dataset.target;
    const version = Number(button.dataset.version);
    setBusy(button, true, '恢复中…');
    if (kind === 'endpoint') await api.restoreEndpointVersion(target, version);
    else await api.restoreScriptVersion(target, version);
    state.modal = null;
    await refreshData();
    showToast(`已恢复到版本 v${version}`, 'success');
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
    const datasource = state.datasources.find((item) => item.id === state.modal.data.dsId);
    const readOnly = Boolean(datasource?.readOnly);
    const defaultMethods = hasPk
      ? (readOnly ? ['list', 'get'] : ['list', 'get', 'create', 'update', 'delete'])
      : (readOnly ? ['list'] : ['list', 'create']);
    state.modal = {
      type: 'generator',
      title: `生成 CRUD · ${table.name}`,
      eyebrow: 'GENERATOR',
      size: 'wide',
      data: {
        dsId: state.modal.data.dsId,
        readOnly,
        tableInfo: table,
        pathBase: `/${slugify(table.name)}`,
        methods: defaultMethods,
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
    if (action === 'delete-script') {
      await api.deleteScript(modal.data.id);
      state.modal = null;
      await refreshData();
      showToast('共享脚本已删除');
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
    } else if (field === 'allowRawSql' || field === 'allowHttp' || field === 'enabled') {
      state.editor[field] = target.checked;
    } else if (field === 'timeoutMs') {
      state.editor.timeoutMs = Math.max(0, Number(target.value) || 0);
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
    let visible = 0;
    for (const row of document.querySelectorAll('.endpoint-row[data-search]')) {
      const filtered = Boolean(needle) && !row.dataset.search.includes(needle);
      row.classList.toggle('is-filtered', filtered);
      if (!filtered) visible += 1;
    }
    const empty = document.querySelector('.api-search-empty');
    if (empty) empty.classList.toggle('is-filtered', !needle || visible > 0);
  }

  function filterTableRows(query) {
    const needle = String(query || '').trim().toLowerCase();
    for (const row of document.querySelectorAll('.table-item[data-table-name]')) {
      row.classList.toggle('is-filtered', Boolean(needle) && !row.dataset.tableName.includes(needle));
    }
  }

  function syncGutter(textarea) {
    const gutter = document.getElementById(
      textarea.id === 'script-input' ? 'script-gutter' : 'sql-gutter'
    );
    if (!gutter) return;
    const count = Math.max(1, textarea.value.split('\n').length);
    gutter.textContent = Array.from({ length: count }, (_, index) => index + 1).join('\n');
    gutter.scrollTop = textarea.scrollTop;
  }

  function handleMouseDown(event) {
    if (event.target.closest('[data-completion-index]')) event.preventDefault();
  }

  return {
    handleClick,
    handleInput,
    handleChange,
    handleKeydown,
    handleMouseDown,
    syncGutter,
    rememberScriptCaret,
    closeScriptCompletion
  };
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
