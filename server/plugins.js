import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { AppError } from './errors.js';
import { truncate } from './utils.js';

const PLUGIN_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/;
const ACTION_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/;

export class PluginRegistry {
  constructor({ pluginsDir }) {
    this.pluginsDir = pluginsDir;
    this.plugins = new Map();
    this.errors = [];
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this.metadata();
    this.loaded = true;
    if (!this.pluginsDir) return this.metadata();
    let entries = [];
    try {
      entries = await fs.readdir(this.pluginsDir, { withFileTypes: true });
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        this.errors.push({ file: '', message: truncate(error?.message || error, 300) });
      }
      return this.metadata();
    }

    for (const entry of entries) {
      if (!entry.isFile() || !/\.(?:js|mjs)$/i.test(entry.name) || entry.name.startsWith('_')) continue;
      const file = path.join(this.pluginsDir, entry.name);
      try {
        const imported = await import(`${pathToFileURL(file).href}?loaded=${Date.now()}`);
        const module = imported?.default && isPlainObject(imported.default) ? imported.default : imported;
        const name = String(module.name || path.basename(entry.name, path.extname(entry.name)));
        if (!PLUGIN_NAME.test(name)) throw new Error(`插件名称无效：${name}`);
        if (this.plugins.has(name)) throw new Error(`插件名称重复：${name}`);
        const actions = module.actions;
        if (!isPlainObject(actions)) throw new Error('插件必须导出 actions 对象');
        const normalizedActions = new Map();
        for (const [action, handler] of Object.entries(actions)) {
          if (!ACTION_NAME.test(action)) throw new Error(`插件函数名称无效：${action}`);
          if (typeof handler !== 'function') throw new Error(`插件函数 ${action} 不是函数`);
          normalizedActions.set(action, handler);
        }
        if (!normalizedActions.size) throw new Error('插件 actions 不能为空');
        this.plugins.set(name, { name, file, actions: normalizedActions });
      } catch (error) {
        this.errors.push({ file: entry.name, message: truncate(error?.message || error, 300) });
      }
    }
    return this.metadata();
  }

  async ensureLoaded() {
    if (!this.loaded) await this.load();
    return this.metadata();
  }

  metadata() {
    return {
      plugins: [...this.plugins.values()].map((plugin) => ({
        name: plugin.name,
        actions: [...plugin.actions.keys()]
      })),
      errors: [...this.errors]
    };
  }

  async call(name, action, args, context) {
    await this.ensureLoaded();
    const plugin = this.plugins.get(name);
    if (!plugin) throw new AppError(`插件不存在：${name}`, 500, 'PLUGIN_NOT_FOUND');
    const handler = plugin.actions.get(action);
    if (!handler) throw new AppError(`插件函数不存在：${name}.${action}`, 500, 'PLUGIN_ACTION_NOT_FOUND');
    if (!Array.isArray(args)) throw new AppError('插件参数格式无效', 500, 'PLUGIN_ARGUMENT_INVALID');
    try {
      return await handler(...args, context);
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        `插件 ${name}.${action} 执行失败：${truncate(error?.message || error, 500)}`,
        500,
        'PLUGIN_EXECUTION_FAILED'
      );
    }
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
