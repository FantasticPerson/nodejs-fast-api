import { api, ApiError } from './api.js';
import { createActions } from './actions.js';
import { state } from './state.js';
import { renderApp, renderModal } from './views.js';

const appRoot = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

document.documentElement.dataset.theme = state.theme;

function applyBootstrap(data) {
  state.datasources = data.datasources || [];
  state.endpoints = data.endpoints || [];
  state.logs = data.logs || [];
  state.config = {
    ...state.config,
    ...(data.config || {})
  };
  state.authError = null;
  state.error = null;
}

function render() {
  appRoot.innerHTML = renderApp();
  modalRoot.innerHTML = renderModal();
  attachTransientListeners();
}

async function refreshData() {
  const data = await api.bootstrap();
  applyBootstrap(data);
  render();
}

async function boot() {
  state.loading = true;
  render();
  try {
    const data = await api.bootstrap();
    applyBootstrap(data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      state.authError = error.message;
    } else {
      state.error = error.message || '无法加载工作台';
    }
  } finally {
    state.loading = false;
    render();
  }
}

const actions = createActions({ render, refreshData, boot });

document.addEventListener('click', actions.handleClick);
document.addEventListener('input', actions.handleInput);
document.addEventListener('change', actions.handleChange);
document.addEventListener('keydown', actions.handleKeydown);
document.addEventListener('submit', (event) => event.preventDefault());

function attachTransientListeners() {
  const sqlInput = document.getElementById('sql-input');
  if (sqlInput) {
    sqlInput.addEventListener('scroll', () => actions.syncGutter(sqlInput), { passive: true });
    actions.syncGutter(sqlInput);
  }
}

boot();
