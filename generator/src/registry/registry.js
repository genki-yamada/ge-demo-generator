import { createDemo, withState } from './demo.js';

export class DemoRegistry {
  constructor(store) {
    this.store = store;
  }

  async register({ domain, suffix, ownerCe, goal, classification, now }) {
    const demo = createDemo({ domain, suffix, ownerCe, goal, classification, now });
    const existing = await this.store.get(demo.id);
    if (existing) {
      throw new Error(`demo already exists: ${demo.id}`);
    }
    await this.store.put(demo);
    return demo;
  }

  async get(id) {
    return this.store.get(id);
  }

  async list() {
    return this.store.list();
  }

  async transition(id, nextState, now) {
    const demo = await this.store.get(id);
    if (!demo) {
      throw new Error(`demo not found: ${id}`);
    }
    const updated = withState(demo, nextState, now);
    await this.store.put(updated);
    return updated;
  }

  async setScriptUri(id, scriptGcsUri, now) {
    const demo = await this.store.get(id);
    if (!demo) {
      throw new Error(`demo not found: ${id}`);
    }
    const updated = { ...demo, scriptGcsUri, updatedAt: now };
    await this.store.put(updated);
    return updated;
  }

  async startCleanup(id, now) {
    const demo = await this.store.get(id);
    if (!demo) throw new Error(`demo not found: ${id}`);
    if (demo.state === 'building') throw new Error(`cannot cleanup while building: ${id}`);
    return this.transition(id, 'deleting', now);
  }

  async finishCleanup(id, ok, now) {
    return this.transition(id, ok ? 'deleted' : 'delete_failed', now);
  }
}
