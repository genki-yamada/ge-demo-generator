export class MemoryStore {
  constructor() {
    this.map = new Map();
  }

  async get(id) {
    return this.map.has(id) ? { ...this.map.get(id) } : null;
  }

  async put(demo) {
    this.map.set(demo.id, { ...demo });
  }

  async list() {
    return [...this.map.values()].map((d) => ({ ...d }));
  }
}
