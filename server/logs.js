import { randomUUID } from 'node:crypto';

export class LogBuffer {
  constructor(limit = 200) {
    this.limit = limit;
    this.items = [];
  }

  add(entry) {
    this.items.unshift({
      id: `log_${randomUUID().replace(/-/g, '').slice(0, 10)}`,
      timestamp: new Date().toISOString(),
      ...entry
    });
    if (this.items.length > this.limit) this.items.length = this.limit;
  }

  list() {
    return this.items;
  }

  clear() {
    this.items = [];
  }
}
