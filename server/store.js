import fs from 'node:fs/promises';
import path from 'node:path';
import { clone } from './utils.js';

function emptyState() {
  return {
    version: 1,
    datasources: [],
    endpoints: []
  };
}

export class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = emptyState();
    this.queue = Promise.resolve();
  }

  async init() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    try {
      const content = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(content);
      this.state = {
        version: 1,
        datasources: Array.isArray(parsed.datasources) ? parsed.datasources : [],
        endpoints: Array.isArray(parsed.endpoints) ? parsed.endpoints : []
      };
      await fs.chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      await this.writeState(this.state, true);
    }
    return this;
  }

  snapshot() {
    return clone(this.state);
  }

  findDatasource(id) {
    return this.state.datasources.find((item) => item.id === id) || null;
  }

  findEndpoint(id) {
    return this.state.endpoints.find((item) => item.id === id) || null;
  }

  async mutate(mutator) {
    const operation = this.queue.then(async () => {
      const result = await mutator(this.state);
      await this.writeState(this.state, false);
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  async writeState(state, createOnly = false) {
    const serialized = `${JSON.stringify(state, null, 2)}\n`;
    if (createOnly) {
      await fs.writeFile(this.filePath, serialized, { mode: 0o600 });
      return;
    }
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, serialized, { mode: 0o600 });
    await fs.rename(tempPath, this.filePath);
    await fs.chmod(this.filePath, 0o600).catch(() => {});
  }
}
