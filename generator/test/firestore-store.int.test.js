import { describe, it, expect, beforeEach } from 'vitest';
import { FirestoreStore } from '../src/registry/firestore-store.js';

// エミュレータが起動しているときだけ実行する。
// 例: gcloud emulators firestore start --host-port=localhost:8085
//     export FIRESTORE_EMULATOR_HOST=localhost:8085
const maybe = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;

maybe('FirestoreStore (emulator)', () => {
  let store;

  beforeEach(() => {
    // コレクション名をユニークにしてテスト間の干渉を避ける
    const unique = `demos-test-${Math.floor(Math.random() * 1e9)}`;
    store = new FirestoreStore({
      projectId: 'demo-test',
      databaseId: '(default)',
      collection: unique,
    });
  });

  it('round-trips a demo and lists it', async () => {
    const demo = {
      id: 'demo-x-1',
      domain: 'x',
      suffix: '1',
      ownerCe: 'ce@example.com',
      goal: '',
      classification: '',
      state: 'building',
      scriptGcsUri: null,
      createdAt: '2026-06-17T00:00:00.000Z',
      updatedAt: '2026-06-17T00:00:00.000Z',
    };
    await store.put(demo);

    const got = await store.get('demo-x-1');
    expect(got.id).toBe('demo-x-1');
    expect(got.ownerCe).toBe('ce@example.com');

    const all = await store.list();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe('demo-x-1');
  });

  it('returns null for a missing demo', async () => {
    expect(await store.get('demo-missing-1')).toBeNull();
  });
});
