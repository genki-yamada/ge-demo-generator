import { describe, it, expect, beforeEach } from 'vitest';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const now = '2026-06-17T00:00:00.000Z';
const later = '2026-06-17T01:00:00.000Z';

describe('DemoRegistry', () => {
  let registry;
  beforeEach(() => {
    registry = new DemoRegistry(new MemoryStore());
  });

  it('registers and reads back a demo', async () => {
    const demo = await registry.register({ domain: 'retail', suffix: 'abc', ownerCe: 'ce@example.com', now });
    expect(demo.id).toBe('demo-retail-abc');
    const got = await registry.get('demo-retail-abc');
    expect(got.ownerCe).toBe('ce@example.com');
    expect(got.state).toBe('building');
  });

  it('refuses duplicate registration', async () => {
    await registry.register({ domain: 'retail', suffix: 'abc', ownerCe: 'c', now });
    await expect(
      registry.register({ domain: 'retail', suffix: 'abc', ownerCe: 'c', now }),
    ).rejects.toThrow(/already exists/);
  });

  it('returns null for unknown id', async () => {
    expect(await registry.get('demo-x-y')).toBeNull();
  });

  it('lists registered demos', async () => {
    await registry.register({ domain: 'a', suffix: '1', ownerCe: 'c', now });
    await registry.register({ domain: 'b', suffix: '2', ownerCe: 'c', now });
    const demos = await registry.list();
    expect(demos).toHaveLength(2);
    expect(demos.map((d) => d.id).sort()).toEqual(['demo-a-1', 'demo-b-2']);
  });

  it('transitions state through the lifecycle', async () => {
    await registry.register({ domain: 'a', suffix: '1', ownerCe: 'c', now });
    const active = await registry.transition('demo-a-1', 'active', later);
    expect(active.state).toBe('active');
    const reread = await registry.get('demo-a-1');
    expect(reread.state).toBe('active');
  });

  it('rejects invalid transition', async () => {
    await registry.register({ domain: 'a', suffix: '1', ownerCe: 'c', now });
    await expect(registry.transition('demo-a-1', 'deleted', later)).rejects.toThrow(/invalid transition/);
  });

  it('throws transitioning a missing demo', async () => {
    await expect(registry.transition('demo-missing-1', 'active', later)).rejects.toThrow(/not found/);
  });

  it('records script uri without changing state', async () => {
    await registry.register({ domain: 'a', suffix: '1', ownerCe: 'c', now });
    const updated = await registry.setScriptUri('demo-a-1', 'gs://bucket/demo-a-1.sh', later);
    expect(updated.scriptGcsUri).toBe('gs://bucket/demo-a-1.sh');
    expect(updated.state).toBe('building');
    expect(updated.updatedAt).toBe(later);
  });

  describe('startCleanup', () => {
    it('transitions active → deleting', async () => {
      await registry.register({ domain: 'c', suffix: '1', ownerCe: 'c', now });
      await registry.transition('demo-c-1', 'active', later);
      const result = await registry.startCleanup('demo-c-1', later);
      expect(result.state).toBe('deleting');
    });

    it('transitions build_failed → deleting', async () => {
      await registry.register({ domain: 'c', suffix: '2', ownerCe: 'c', now });
      await registry.transition('demo-c-2', 'build_failed', later);
      const result = await registry.startCleanup('demo-c-2', later);
      expect(result.state).toBe('deleting');
    });

    it('transitions delete_failed → deleting (retry)', async () => {
      await registry.register({ domain: 'c', suffix: '3', ownerCe: 'c', now });
      await registry.transition('demo-c-3', 'active', later);
      await registry.transition('demo-c-3', 'deleting', later);
      await registry.transition('demo-c-3', 'delete_failed', later);
      const result = await registry.startCleanup('demo-c-3', later);
      expect(result.state).toBe('deleting');
    });

    it('rejects with building guard when state=building', async () => {
      await registry.register({ domain: 'c', suffix: '4', ownerCe: 'c', now });
      // state is 'building' after register
      await expect(registry.startCleanup('demo-c-4', later)).rejects.toThrow(
        /cannot cleanup while building/,
      );
    });

    it('rejects via state machine when already deleting', async () => {
      await registry.register({ domain: 'c', suffix: '5', ownerCe: 'c', now });
      await registry.transition('demo-c-5', 'active', later);
      await registry.transition('demo-c-5', 'deleting', later);
      await expect(registry.startCleanup('demo-c-5', later)).rejects.toThrow(/invalid transition/);
    });

    it('rejects via state machine when already deleted (terminal)', async () => {
      await registry.register({ domain: 'c', suffix: '6', ownerCe: 'c', now });
      await registry.transition('demo-c-6', 'active', later);
      await registry.transition('demo-c-6', 'deleting', later);
      await registry.transition('demo-c-6', 'deleted', later);
      await expect(registry.startCleanup('demo-c-6', later)).rejects.toThrow(/invalid transition/);
    });

    it('throws for unknown id', async () => {
      await expect(registry.startCleanup('demo-missing-x', later)).rejects.toThrow(/not found/);
    });
  });

  describe('finishCleanup', () => {
    it('transitions deleting → deleted when ok=true', async () => {
      await registry.register({ domain: 'f', suffix: '1', ownerCe: 'c', now });
      await registry.transition('demo-f-1', 'active', later);
      await registry.transition('demo-f-1', 'deleting', later);
      const result = await registry.finishCleanup('demo-f-1', true, later);
      expect(result.state).toBe('deleted');
    });

    it('transitions deleting → delete_failed when ok=false', async () => {
      await registry.register({ domain: 'f', suffix: '2', ownerCe: 'c', now });
      await registry.transition('demo-f-2', 'active', later);
      await registry.transition('demo-f-2', 'deleting', later);
      const result = await registry.finishCleanup('demo-f-2', false, later);
      expect(result.state).toBe('delete_failed');
    });

    it('rejects via state machine when not in deleting state', async () => {
      await registry.register({ domain: 'f', suffix: '3', ownerCe: 'c', now });
      await registry.transition('demo-f-3', 'active', later);
      await expect(registry.finishCleanup('demo-f-3', true, later)).rejects.toThrow(
        /invalid transition/,
      );
    });
  });
});
