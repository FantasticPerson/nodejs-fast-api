import { randomUUID } from 'node:crypto';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import { listTables, getTableInfo } from '../metadata.js';
import { parseBoolean, parsePositiveInteger } from '../utils.js';

const TYPES = new Set(['mysql', 'oracle']);

export class DatasourceService {
  constructor({ store, secretBox, driverManager }) {
    this.store = store;
    this.secretBox = secretBox;
    this.driverManager = driverManager;
  }

  list() {
    const snapshot = this.store.snapshot();
    return snapshot.datasources.map((datasource) => ({
      ...sanitizeDatasource(datasource),
      endpointCount: snapshot.endpoints.filter((endpoint) => endpoint.datasourceId === datasource.id).length
    }));
  }

  get(id) {
    const datasource = this.store.findDatasource(id);
    if (!datasource) throw new NotFoundError('数据源不存在');
    return sanitizeDatasource(datasource);
  }

  async create(input) {
    const normalized = this.normalizeInput(input);
    const snapshot = this.store.snapshot();
    assertUniqueName(snapshot.datasources, normalized.name, null);
    const now = new Date().toISOString();
    const record = {
      id: `ds_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      ...normalized,
      passwordEnc: normalized.password ? this.secretBox.encrypt(normalized.password) : null,
      createdAt: now,
      updatedAt: now
    };
    delete record.password;
    await this.store.mutate((state) => {
      state.datasources.push(record);
    });
    return sanitizeDatasource(record);
  }

  async update(id, input) {
    const existing = this.store.findDatasource(id);
    if (!existing) throw new NotFoundError('数据源不存在');
    const normalized = this.normalizeInput(input);
    const snapshot = this.store.snapshot();
    assertUniqueName(snapshot.datasources, normalized.name, id);
    const update = {
      ...existing,
      ...normalized,
      updatedAt: new Date().toISOString()
    };
    if (normalized.password) {
      update.passwordEnc = this.secretBox.encrypt(normalized.password);
    }
    delete update.password;
    await this.store.mutate((state) => {
      const index = state.datasources.findIndex((item) => item.id === id);
      state.datasources[index] = update;
    });
    await this.driverManager.closePool(id);
    return sanitizeDatasource(update);
  }

  async remove(id) {
    const snapshot = this.store.snapshot();
    if (!snapshot.datasources.some((item) => item.id === id)) throw new NotFoundError('数据源不存在');
    const usedBy = snapshot.endpoints.filter((endpoint) => endpoint.datasourceId === id);
    if (usedBy.length) {
      throw new ConflictError(
        `该数据源仍被 ${usedBy.length} 个接口使用，请先删除或迁移这些接口`,
        { endpointIds: usedBy.map((endpoint) => endpoint.id) }
      );
    }
    await this.store.mutate((state) => {
      state.datasources = state.datasources.filter((item) => item.id !== id);
    });
    await this.driverManager.closePool(id);
  }

  async resolveById(id) {
    const datasource = this.store.findDatasource(id);
    if (!datasource) throw new NotFoundError('数据源不存在');
    return this.resolveRecord(datasource);
  }

  async testById(id) {
    const datasource = await this.resolveById(id);
    return this.driverManager.test(datasource);
  }

  async testDraft(input) {
    const existing = input.id ? this.store.findDatasource(input.id) : null;
    const normalized = this.normalizeInput(input);
    const password = normalized.password
      ? normalized.password
      : existing?.passwordEnc
        ? this.secretBox.decrypt(existing.passwordEnc)
        : '';
    return this.driverManager.test({ ...normalized, password });
  }

  async listTables(id) {
    const datasource = await this.resolveById(id);
    return listTables(this.driverManager, datasource);
  }

  async getTableInfo(id, tableName) {
    const datasource = await this.resolveById(id);
    return getTableInfo(this.driverManager, datasource, tableName);
  }

  async resolveRecord(datasource) {
    return {
      ...datasource,
      password: datasource.passwordEnc ? this.secretBox.decrypt(datasource.passwordEnc) : ''
    };
  }

  normalizeInput(input = {}) {
    const type = String(input.type || '').toLowerCase();
    if (!TYPES.has(type)) throw new ValidationError('数据源类型必须是 mysql 或 oracle');
    const name = String(input.name || '').trim();
    if (!name) throw new ValidationError('数据源名称不能为空');
    if (name.length > 80) throw new ValidationError('数据源名称不能超过 80 个字符');
    const host = String(input.host || '127.0.0.1').trim();
    if (!host) throw new ValidationError('主机地址不能为空');
    const port = parsePositiveInteger(input.port, type === 'oracle' ? 1521 : 3306, { min: 1, max: 65535 });
    const username = String(input.username || '').trim();
    if (!username) throw new ValidationError('用户名不能为空');
    const password = typeof input.password === 'string' ? input.password : '';
    const database = String(input.database || '').trim();
    const serviceName = String(input.serviceName || '').trim();
    const connectString = String(input.connectString || '').trim();
    const schema = String(input.schema || '').trim().toUpperCase();
    const readOnly = parseBoolean(input.readOnly, false);
    if (type === 'mysql' && !database) throw new ValidationError('MySQL 数据库名不能为空');
    if (type === 'oracle' && !connectString && !serviceName) {
      throw new ValidationError('Oracle 需要填写服务名 / SID，或直接填写连接字符串');
    }
    return {
      type,
      name,
      host,
      port,
      username,
      password,
      database,
      serviceName,
      connectString,
      schema,
      readOnly
    };
  }

  driverStatus() {
    return this.driverManager.driverStatus();
  }
}

function sanitizeDatasource(datasource) {
  return {
    id: datasource.id,
    name: datasource.name,
    type: datasource.type,
    host: datasource.host,
    port: datasource.port,
    database: datasource.database || '',
    serviceName: datasource.serviceName || '',
    connectString: datasource.connectString || '',
    schema: datasource.schema || '',
    readOnly: Boolean(datasource.readOnly),
    username: datasource.username,
    hasPassword: Boolean(datasource.passwordEnc),
    createdAt: datasource.createdAt,
    updatedAt: datasource.updatedAt
  };
}

function assertUniqueName(datasources, name, currentId) {
  const exists = datasources.some(
    (item) => item.id !== currentId && item.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) throw new ConflictError(`数据源名称已存在：${name}`);
}
