import { describe, it, expect } from 'vitest';
import {
  createDemo,
  withState,
  canTransition,
  makeDemoId,
  DEMO_STATES,
} from '../src/registry/demo.js';

const now = '2026-06-17T00:00:00.000Z';
const later = '2026-06-17T01:00:00.000Z';

describe('demo model', () => {
  it('derives id as demo-<domain>-<suffix>', () => {
    expect(makeDemoId('retail', 'abc')).toBe('demo-retail-abc');
  });

  it('creates a demo in building state', () => {
    const demo = createDemo({ domain: 'retail', suffix: 'abc', ownerCe: 'ce@example.com', now });
    expect(demo.id).toBe('demo-retail-abc');
    expect(demo.state).toBe(DEMO_STATES.BUILDING);
    expect(demo.ownerCe).toBe('ce@example.com');
    expect(demo.createdAt).toBe(now);
    expect(demo.updatedAt).toBe(now);
    expect(demo.scriptGcsUri).toBeNull();
    expect(demo.goal).toBe('');
    expect(demo.classification).toBe('');
  });

  it('requires domain, suffix, ownerCe, now', () => {
    expect(() => createDemo({ suffix: 'a', ownerCe: 'c', now })).toThrow(/domain/);
    expect(() => createDemo({ domain: 'd', ownerCe: 'c', now })).toThrow(/suffix/);
    expect(() => createDemo({ domain: 'd', suffix: 'a', now })).toThrow(/ownerCe/);
    expect(() => createDemo({ domain: 'd', suffix: 'a', ownerCe: 'c' })).toThrow(/now/);
  });

  it('allows valid transitions and forbids invalid ones', () => {
    expect(canTransition('building', 'active')).toBe(true);
    expect(canTransition('building', 'build_failed')).toBe(true);
    expect(canTransition('active', 'deleting')).toBe(true);
    expect(canTransition('deleting', 'deleted')).toBe(true);
    expect(canTransition('deleting', 'delete_failed')).toBe(true);
    expect(canTransition('delete_failed', 'deleting')).toBe(true);
    expect(canTransition('active', 'deleted')).toBe(false);
    expect(canTransition('deleted', 'active')).toBe(false);
    expect(canTransition('building', 'deleted')).toBe(false);
  });

  it('withState advances state and bumps updatedAt only', () => {
    const demo = createDemo({ domain: 'd', suffix: 'a', ownerCe: 'c', now });
    const active = withState(demo, 'active', later);
    expect(active.state).toBe('active');
    expect(active.updatedAt).toBe(later);
    expect(active.createdAt).toBe(now);
  });

  it('withState throws on invalid transition', () => {
    const demo = createDemo({ domain: 'd', suffix: 'a', ownerCe: 'c', now });
    expect(() => withState(demo, 'deleted', later)).toThrow(/invalid transition/);
  });
});
