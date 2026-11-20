import { ConflictError, NotFoundError, ValidationError } from '../errors.js';

const SCRIPT_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,59}$/;
const MAX_SCRIPT_CODE_LENGTH = 65536;

export class ScriptLibraryService {
  constructor({ store }) {
    this.store = store;
  }

  list() {
    return this.store.listScriptLibraries();
  }

  get(name) {
    const library = this.store.findScriptLibrary(name);
    if (!library) throw new NotFoundError('共享脚本不存在');
    return library;
  }

  async create(input) {
    const normalized = normalizeLibrary(input);
    if (this.store.findScriptLibrary(normalized.name)) {
      throw new ConflictError(`共享脚本名称已存在：${normalized.name}`);
    }
    return this.store.insertScriptLibrary(normalized);
  }

  async update(name, input) {
    if (!this.store.findScriptLibrary(name)) throw new NotFoundError('共享脚本不存在');
    return this.store.updateScriptLibrary(name, normalizeLibrary({ ...input, name }));
  }

  async remove(name) {
    if (!this.store.findScriptLibrary(name)) throw new NotFoundError('共享脚本不存在');
    await this.store.deleteScriptLibrary(name);
  }

  listVersions(name) {
    if (!this.store.findScriptLibrary(name)) throw new NotFoundError('共享脚本不存在');
    return this.store.listScriptLibraryVersions(name);
  }

  async restoreVersion(name, version) {
    if (!this.store.findScriptLibrary(name)) throw new NotFoundError('共享脚本不存在');
    const selected = this.store.findScriptLibraryVersion(name, version);
    if (!selected) throw new NotFoundError('共享脚本版本不存在');
    return this.store.updateScriptLibrary(name, selected.definition);
  }

  enabledLibraries() {
    return this.store.listScriptLibraries().filter((library) => library.enabled);
  }
}

function normalizeLibrary(input = {}) {
  const name = String(input.name || '').trim();
  if (!SCRIPT_NAME.test(name)) {
    throw new ValidationError('共享脚本名称必须以字母或下划线开头，且不超过 60 个字符');
  }
  const description = String(input.description || '').trim();
  if (description.length > 500) throw new ValidationError('共享脚本描述不能超过 500 个字符');
  const code = String(input.code ?? '');
  if (!code.trim()) throw new ValidationError('共享脚本代码不能为空');
  if (code.length > MAX_SCRIPT_CODE_LENGTH) {
    throw new ValidationError(`共享脚本代码不能超过 ${MAX_SCRIPT_CODE_LENGTH} 个字符`);
  }
  return {
    name,
    description,
    code,
    enabled: input.enabled !== false
  };
}
