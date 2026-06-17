# Generator 基盤（Cloud Run + IAP + Firestore Demo Registry + Terraform）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **コミット規約:** 各コミットメッセージの末尾に `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` を付ける（本計画の `git commit` コマンドに同梱済み）。
> **リポジトリ規約（厳守）:** push/pull/fetch 等はフォーク `genki-yamada/ge-demo-generator`（origin）に対してのみ。元リポジトリ `ryotat7/...` への参照禁止（CLAUDE.md / `.claude/settings.json` フック）。

**Goal:** GAS を廃した新 Generator の土台として、Cloud Run 上で動く Node.js バックエンドを立ち上げ、IAP 認証・Firestore 名前付き DB「generator」上の Demo Registry 読み書き・Terraform によるプロビジョニングまでを「空のレジストリを読み書きできる最小アプリ」として動作・テスト可能にする。

**Architecture:** Express(Node.js, ESM) のアプリを `buildApp({ registry, authMiddleware })` で組み立て、依存（Demo Registry のストア実装・IAP 検証関数）を注入可能にして単体テストを成立させる。Demo Registry はドメインモデル（状態機械）＋ストア抽象（`MemoryStore`＝テスト/ローカル、`FirestoreStore`＝本番）の二層。認証は IAP の `x-goog-iap-jwt-assertion` を `google-auth-library` で検証するミドルウェア（検証関数を注入可能、ローカルは `DEV_USER_EMAIL` フォールバック）。インフラは Terraform で API 有効化・Firestore 名前付き DB・Artifact Registry・実行 SA・Cloud Run サービスを定義し、IAP 有効化と閲覧者付与は gcloud runbook で行う。

**Tech Stack:** Node.js 20 (ESM) / Express 4 / `@google-cloud/firestore` 7 / `google-auth-library` 9 / テスト: Vitest 2 + Supertest 7 / Firestore エミュレータ（統合テスト、任意）/ Terraform（google provider 5〜6）/ gcloud + Cloud Build + Artifact Registry。

**Scope（この計画に含む / 含まない）:**
- 含む: Node バックエンド雛形、Demo モデルと状態機械、Demo Registry（register/get/list/transition/setScriptUri）、Demo の **読み取り** HTTP API、IAP 認証ミドルウェア、Dockerfile、Terraform ブートストラップ、ビルド/デプロイ/IAP runbook。
- 含まない（後続計画）: 実際のデモ構築（Plan C）、`generateSetupScript` の移植（Plan B）、GCS へのスクリプト保存と Cleanup 実行（Plan D）、構築開始用の書き込み API/UI（Plan C）。本計画の Demo Registry は後続が乗る土台。

**配置方針:** 新 Node コードは既存 GAS（`Code.gs` / `index.html`）と分離するため `generator/` 配下に新設。インフラは `infra/terraform/` に新設。ビッグバン切替（ADR-0001）まで両者は併存する。

---

## File Structure

```
generator/
├── package.json                      # Node プロジェクト定義（ESM, scripts, deps）
├── package-lock.json                 # npm ci 用ロックファイル（Task 0 で生成）
├── vitest.config.js                  # テスト設定
├── .dockerignore
├── Dockerfile                        # Cloud Run 用イメージ
├── src/
│   ├── server.js                     # 本番エントリ: Firestore + 実 IAP を結線し listen
│   ├── app.js                        # buildApp({registry, authMiddleware}) → Express app
│   ├── auth/
│   │   └── iap.js                    # verifyIapJwt + iapAuth ミドルウェア（検証関数注入可）
│   ├── registry/
│   │   ├── demo.js                   # Demo ドメインモデル + 状態機械（純関数）
│   │   ├── registry.js               # DemoRegistry クラス（store を注入）
│   │   ├── memory-store.js           # インメモリ store（テスト/ローカル）
│   │   └── firestore-store.js        # Firestore 実装 store
│   └── routes/
│       └── demos.js                  # GET /api/demos, GET /api/demos/:id
└── test/
    ├── demo.test.js
    ├── registry.test.js
    ├── iap.test.js
    ├── routes.demos.test.js
    └── firestore-store.int.test.js   # エミュレータ統合（FIRESTORE_EMULATOR_HOST 未設定時はスキップ）

infra/terraform/
├── main.tf                           # provider / API / Firestore / AR / SA / Cloud Run
├── variables.tf
├── outputs.tf
└── README.md                         # apply 手順と IAP runbook
```

各ファイルの責務は単一（モデル/レジストリ/ストア/認証/ルーティング/結線で分離）。`buildApp` が依存注入点で、これによりネットワーク・GCP に触れずに大半をテストできる。

---

## Task 0: `generator/` の Node プロジェクトを足場づくり

**Files:**
- Create: `generator/package.json`
- Create: `generator/vitest.config.js`
- Create: `generator/.dockerignore`

- [ ] **Step 1: `generator/package.json` を作成**

```json
{
  "name": "ge-demo-generator-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node src/server.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@google-cloud/firestore": "^7.10.0",
    "express": "^4.21.2",
    "google-auth-library": "^9.15.0"
  },
  "devDependencies": {
    "supertest": "^7.0.0",
    "vitest": "^2.1.8"
  }
}
```

- [ ] **Step 2: `generator/vitest.config.js` を作成**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
  },
});
```

- [ ] **Step 3: `generator/.dockerignore` を作成**

```
node_modules
test
vitest.config.js
*.md
.env*
```

- [ ] **Step 4: 依存をインストール（lockfile 生成）**

Run: `cd generator && npm install`
Expected: `node_modules/` が作られ、`generator/package-lock.json` が生成される。エラーなく完了。

- [ ] **Step 5: テストランナーが動くことを確認（まだテストは無い）**

Run: `cd generator && npx vitest run`
Expected: `No test files found` 相当のメッセージで終了（exit 0 でなくても可、クラッシュしなければ良い）。Vitest が起動できることだけ確認する。

- [ ] **Step 6: Commit**

```bash
cd generator && git add package.json package-lock.json vitest.config.js .dockerignore
git commit -m "chore(generator): scaffold Node.js backend project" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 1: Demo ドメインモデルと状態機械

`demo.js` は純関数のみ（I/O なし）。状態は ADR-0004 の `building / active / build_failed / deleting / deleted / delete_failed`。時刻は `now`（ISO 文字列）を引数で受け取り、決定的にテストする。

**Files:**
- Create: `generator/src/registry/demo.js`
- Test: `generator/test/demo.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`generator/test/demo.test.js`:
```js
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
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd generator && npx vitest run test/demo.test.js`
Expected: FAIL（`Failed to resolve import '../src/registry/demo.js'` 等）。

- [ ] **Step 3: 最小実装を書く**

`generator/src/registry/demo.js`:
```js
export const DEMO_STATES = Object.freeze({
  BUILDING: 'building',
  ACTIVE: 'active',
  BUILD_FAILED: 'build_failed',
  DELETING: 'deleting',
  DELETED: 'deleted',
  DELETE_FAILED: 'delete_failed',
});

const VALID_TRANSITIONS = Object.freeze({
  building: ['active', 'build_failed'],
  active: ['deleting'],
  build_failed: ['deleting'],
  deleting: ['deleted', 'delete_failed'],
  delete_failed: ['deleting'],
  deleted: [],
});

export function makeDemoId(domain, suffix) {
  return `demo-${domain}-${suffix}`;
}

export function canTransition(from, to) {
  const allowed = VALID_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
}

export function createDemo({ domain, suffix, ownerCe, goal, classification, now }) {
  if (!domain) throw new Error('domain is required');
  if (!suffix) throw new Error('suffix is required');
  if (!ownerCe) throw new Error('ownerCe is required');
  if (!now) throw new Error('now is required');
  return {
    id: makeDemoId(domain, suffix),
    domain,
    suffix,
    ownerCe,
    goal: goal ?? '',
    classification: classification ?? '',
    state: DEMO_STATES.BUILDING,
    scriptGcsUri: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function withState(demo, nextState, now) {
  if (!canTransition(demo.state, nextState)) {
    throw new Error(`invalid transition: ${demo.state} -> ${nextState}`);
  }
  return { ...demo, state: nextState, updatedAt: now };
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `cd generator && npx vitest run test/demo.test.js`
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
cd generator && git add src/registry/demo.js test/demo.test.js
git commit -m "feat(generator): add Demo domain model and lifecycle state machine" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: MemoryStore と DemoRegistry

`DemoRegistry` はストア（`get/put/list` の async インターフェース）を注入され、`register/get/list/transition/setScriptUri` を提供する。`MemoryStore` はテストとローカル開発用の実装。

**Files:**
- Create: `generator/src/registry/memory-store.js`
- Create: `generator/src/registry/registry.js`
- Test: `generator/test/registry.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`generator/test/registry.test.js`:
```js
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
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd generator && npx vitest run test/registry.test.js`
Expected: FAIL（import 解決不可）。

- [ ] **Step 3: `MemoryStore` を実装**

`generator/src/registry/memory-store.js`:
```js
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
```

- [ ] **Step 4: `DemoRegistry` を実装**

`generator/src/registry/registry.js`:
```js
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
}
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `cd generator && npx vitest run test/registry.test.js`
Expected: PASS（8 tests）。

- [ ] **Step 6: Commit**

```bash
cd generator && git add src/registry/memory-store.js src/registry/registry.js test/registry.test.js
git commit -m "feat(generator): add DemoRegistry with in-memory store" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: FirestoreStore（名前付き DB「generator」対応）

`FirestoreStore` は `MemoryStore` と同じインターフェース（`get/put/list`）を Firestore 上に実装する。コンストラクタで `firestore` クライアントを注入できるようにし、統合テストはエミュレータがあるときだけ実行する（`FIRESTORE_EMULATOR_HOST` 未設定なら `describe.skip`）。

**Files:**
- Create: `generator/src/registry/firestore-store.js`
- Test: `generator/test/firestore-store.int.test.js`

- [ ] **Step 1: 統合テストを書く（ガード付き）**

`generator/test/firestore-store.int.test.js`:
```js
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
```

- [ ] **Step 2: テストを実行してスキップを確認（エミュレータ無し前提）**

Run: `cd generator && npx vitest run test/firestore-store.int.test.js`
Expected: スキップ表示（`2 skipped` 等）。失敗ゼロ。

- [ ] **Step 3: `FirestoreStore` を実装**

`generator/src/registry/firestore-store.js`:
```js
import { Firestore } from '@google-cloud/firestore';

export class FirestoreStore {
  constructor({ projectId, databaseId = 'generator', collection = 'demos', firestore } = {}) {
    this.firestore = firestore ?? new Firestore({ projectId, databaseId });
    this.collectionName = collection;
  }

  _doc(id) {
    return this.firestore.collection(this.collectionName).doc(id);
  }

  async get(id) {
    const snap = await this._doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async put(demo) {
    await this._doc(demo.id).set(demo);
  }

  async list() {
    const snap = await this.firestore.collection(this.collectionName).get();
    return snap.docs.map((d) => d.data());
  }
}
```

- [ ] **Step 4: 全テストを実行して既存が壊れていないこと＋スキップを確認**

Run: `cd generator && npx vitest run`
Expected: `demo.test.js` と `registry.test.js` が PASS、`firestore-store.int.test.js` は skipped。失敗ゼロ。

- [ ] **Step 5: Commit**

```bash
cd generator && git add src/registry/firestore-store.js test/firestore-store.int.test.js
git commit -m "feat(generator): add Firestore-backed registry store for named DB" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: IAP 認証ミドルウェア

IAP は `x-goog-iap-jwt-assertion` ヘッダを付ける。`google-auth-library` の `OAuth2Client` で検証する。検証関数 `verify` を注入可能にして、単体テストでネットワークに触れずに済むようにする。ローカル開発では `DEV_USER_EMAIL` をフォールバックに使う。

**Files:**
- Create: `generator/src/auth/iap.js`
- Test: `generator/test/iap.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`generator/test/iap.test.js`:
```js
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { iapAuth } from '../src/auth/iap.js';

function appWith(middleware) {
  const app = express();
  app.use('/api', middleware);
  app.get('/api/ping', (req, res) => res.json({ email: req.user?.email ?? null }));
  return app;
}

describe('iapAuth middleware', () => {
  it('rejects with 401 when assertion header missing and no dev fallback', async () => {
    const app = appWith(iapAuth({ audience: 'aud' }));
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(401);
  });

  it('uses dev fallback email when header missing and devUserEmail set', async () => {
    const app = appWith(iapAuth({ audience: 'aud', devUserEmail: 'dev@example.com' }));
    const res = await request(app).get('/api/ping');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('dev@example.com');
  });

  it('sets req.user from the verified payload', async () => {
    const verify = async (token, audience) => {
      expect(token).toBe('tok');
      expect(audience).toBe('aud');
      return { email: 'real@example.com', sub: '123' };
    };
    const app = appWith(iapAuth({ audience: 'aud', verify }));
    const res = await request(app).get('/api/ping').set('x-goog-iap-jwt-assertion', 'tok');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('real@example.com');
  });

  it('rejects with 401 when verification throws', async () => {
    const verify = async () => {
      throw new Error('bad token');
    };
    const app = appWith(iapAuth({ audience: 'aud', verify }));
    const res = await request(app).get('/api/ping').set('x-goog-iap-jwt-assertion', 'tok');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd generator && npx vitest run test/iap.test.js`
Expected: FAIL（import 解決不可）。

- [ ] **Step 3: `iap.js` を実装**

`generator/src/auth/iap.js`:
```js
import { OAuth2Client } from 'google-auth-library';

const IAP_JWT_HEADER = 'x-goog-iap-jwt-assertion';
const IAP_ISSUERS = ['https://cloud.google.com/iap'];

// IAP が付与する JWT アサーションを検証し payload を返す。
// audience は IAP の設定値（Plan A の runbook 参照）。
export async function verifyIapJwt(token, audience, client = new OAuth2Client()) {
  const { pubkeys } = await client.getIapPublicKeys();
  const ticket = await client.verifySignedJwtWithCertsAsync(
    token,
    pubkeys,
    audience,
    IAP_ISSUERS,
  );
  return ticket.getPayload();
}

// Express ミドルウェアを生成する。verify は注入可能（テスト用）。
export function iapAuth({ audience, verify = verifyIapJwt, devUserEmail = null }) {
  return async function iapAuthMiddleware(req, res, next) {
    const token = req.header(IAP_JWT_HEADER);
    if (!token) {
      if (devUserEmail) {
        req.user = { email: devUserEmail };
        return next();
      }
      return res.status(401).json({ error: 'missing IAP assertion' });
    }
    try {
      const payload = await verify(token, audience);
      req.user = { email: payload.email, sub: payload.sub };
      return next();
    } catch (err) {
      return res.status(401).json({ error: 'invalid IAP assertion' });
    }
  };
}
```

- [ ] **Step 4: テストを実行して通過を確認**

Run: `cd generator && npx vitest run test/iap.test.js`
Expected: PASS（4 tests）。

- [ ] **Step 5: Commit**

```bash
cd generator && git add src/auth/iap.js test/iap.test.js
git commit -m "feat(generator): add IAP JWT auth middleware with dev fallback" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Express アプリと Demo 読み取り API

`buildApp({ registry, authMiddleware })` で組み立てる。`/healthz` は認証不要、`/api/*` は `authMiddleware` を通す。Demo の読み取り（一覧・個別）を提供。Supertest で HTTP レベルのテストを書く（認証はパススルーのスタブを注入）。

**Files:**
- Create: `generator/src/routes/demos.js`
- Create: `generator/src/app.js`
- Test: `generator/test/routes.demos.test.js`

- [ ] **Step 1: 失敗するテストを書く**

`generator/test/routes.demos.test.js`:
```js
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app.js';
import { DemoRegistry } from '../src/registry/registry.js';
import { MemoryStore } from '../src/registry/memory-store.js';

const now = '2026-06-17T00:00:00.000Z';

function passThroughAuth(req, res, next) {
  req.user = { email: 'ce@example.com' };
  next();
}

describe('demos routes', () => {
  let app;
  let registry;

  beforeEach(async () => {
    registry = new DemoRegistry(new MemoryStore());
    await registry.register({ domain: 'retail', suffix: 'abc', ownerCe: 'ce@example.com', now });
    app = buildApp({ registry, authMiddleware: passThroughAuth });
  });

  it('GET /healthz is public and returns ok', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('GET /api/demos lists demos', async () => {
    const res = await request(app).get('/api/demos');
    expect(res.status).toBe(200);
    expect(res.body.demos).toHaveLength(1);
    expect(res.body.demos[0].id).toBe('demo-retail-abc');
  });

  it('GET /api/demos/:id returns a demo', async () => {
    const res = await request(app).get('/api/demos/demo-retail-abc');
    expect(res.status).toBe(200);
    expect(res.body.demo.state).toBe('building');
  });

  it('GET /api/demos/:id returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/demos/demo-x-y');
    expect(res.status).toBe(404);
  });
});

describe('demos routes auth enforcement', () => {
  it('blocks /api when auth middleware rejects', async () => {
    const registry = new DemoRegistry(new MemoryStore());
    const denyAuth = (req, res) => res.status(401).json({ error: 'denied' });
    const app = buildApp({ registry, authMiddleware: denyAuth });
    const res = await request(app).get('/api/demos');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: テストを実行して失敗を確認**

Run: `cd generator && npx vitest run test/routes.demos.test.js`
Expected: FAIL（import 解決不可）。

- [ ] **Step 3: `routes/demos.js` を実装**

`generator/src/routes/demos.js`:
```js
import { Router } from 'express';

export function demosRouter(registry) {
  const router = Router();

  router.get('/', async (req, res, next) => {
    try {
      const demos = await registry.list();
      res.json({ demos });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const demo = await registry.get(req.params.id);
      if (!demo) {
        return res.status(404).json({ error: 'not found' });
      }
      res.json({ demo });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
```

- [ ] **Step 4: `app.js` を実装**

`generator/src/app.js`:
```js
import express from 'express';
import { demosRouter } from './routes/demos.js';

export function buildApp({ registry, authMiddleware }) {
  const app = express();
  app.use(express.json());

  // 認証不要のヘルスチェック
  app.get('/healthz', (req, res) => res.json({ status: 'ok' }));

  // /api 配下は認証必須
  app.use('/api', authMiddleware);
  app.use('/api/demos', demosRouter(registry));

  // 集約エラーハンドラ
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}
```

- [ ] **Step 5: テストを実行して通過を確認**

Run: `cd generator && npx vitest run test/routes.demos.test.js`
Expected: PASS（5 tests）。

- [ ] **Step 6: 全テストを実行**

Run: `cd generator && npx vitest run`
Expected: `demo` `registry` `iap` `routes.demos` が PASS、`firestore-store.int` は skipped。失敗ゼロ。

- [ ] **Step 7: Commit**

```bash
cd generator && git add src/routes/demos.js src/app.js test/routes.demos.test.js
git commit -m "feat(generator): add Express app and demo read API" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 本番エントリ（server.js）と Dockerfile

`server.js` は環境変数から Firestore（名前付き DB `generator`）と実 IAP を結線して `listen` する。`buildApp` は Task 5 でテスト済みなので、ここは結線のみ（ロジックは持たない）。

**Files:**
- Create: `generator/src/server.js`
- Create: `generator/Dockerfile`

- [ ] **Step 1: `server.js` を実装**

`generator/src/server.js`:
```js
import { buildApp } from './app.js';
import { DemoRegistry } from './registry/registry.js';
import { FirestoreStore } from './registry/firestore-store.js';
import { iapAuth } from './auth/iap.js';

const port = process.env.PORT || 8080;
const projectId = process.env.GOOGLE_CLOUD_PROJECT;
const databaseId = process.env.FIRESTORE_DATABASE_ID || 'generator';
const iapAudience = process.env.IAP_AUDIENCE;
const devUserEmail = process.env.DEV_USER_EMAIL || null;

const store = new FirestoreStore({ projectId, databaseId });
const registry = new DemoRegistry(store);
const authMiddleware = iapAuth({ audience: iapAudience, devUserEmail });

const app = buildApp({ registry, authMiddleware });

app.listen(port, () => {
  console.log(`generator backend listening on ${port} (db=${databaseId})`);
});
```

- [ ] **Step 2: ローカルで起動できることを確認（DEV フォールバックで Firestore に触れず health のみ確認）**

Run:
```bash
cd generator && DEV_USER_EMAIL=dev@example.com PORT=8080 node src/server.js &
sleep 2
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/healthz
kill %1
```
Expected: `200`（`/healthz` は認証・Firestore 不要なので Firestore 未設定でも応答する）。確認後プロセスは kill する。

> 注: `/api/demos` はこの起動だと Firestore（ADC/プロジェクト）へ接続を試みるため、ローカルではエミュレータ（Task 3 の手順）または実プロジェクトの ADC が必要。本ステップでは health のみ確認する。

- [ ] **Step 3: `Dockerfile` を作成**

`generator/Dockerfile`:
```dockerfile
FROM node:20-slim
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/server.js"]
```

- [ ] **Step 4: イメージがローカルでビルドできることを確認（Docker 利用可能な場合）**

Run: `cd generator && docker build -t generator-local:test .`
Expected: ビルド成功（`naming to docker.io/library/generator-local:test`）。Docker が無い環境では本ステップをスキップし、Task 8 の Cloud Build で検証する。

- [ ] **Step 5: Commit**

```bash
cd generator && git add src/server.js Dockerfile
git commit -m "feat(generator): add production server entrypoint and Dockerfile" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Terraform ブートストラップ

API 有効化・Firestore 名前付き DB「generator」・Artifact Registry・実行 SA＋IAM・Cloud Run サービスを定義する。IAP 有効化と閲覧者付与は Task 8 の gcloud runbook で行う（IAP-on-Cloud-Run は launch stage が流動的なため、確実な gcloud に寄せる）。

**Files:**
- Create: `infra/terraform/variables.tf`
- Create: `infra/terraform/main.tf`
- Create: `infra/terraform/outputs.tf`
- Create: `infra/terraform/README.md`

- [ ] **Step 1: `variables.tf` を作成**

`infra/terraform/variables.tf`:
```hcl
variable "project_id" {
  type        = string
  description = "デモプロジェクトの GCP プロジェクト ID"
}

variable "region" {
  type        = string
  description = "Generator をデプロイするリージョン"
  default     = "asia-northeast1"
}

variable "firestore_location" {
  type        = string
  description = "Firestore 名前付き DB のロケーション"
  default     = "asia-northeast1"
}

variable "generator_database_id" {
  type        = string
  description = "Generator 専用 Firestore 名前付きデータベース ID"
  default     = "generator"
}

variable "generator_image" {
  type        = string
  description = "Generator バックエンドのコンテナイメージ。初回は placeholder、以降は Task 8 のビルド成果物を指す"
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}
```

- [ ] **Step 2: `main.tf` を作成**

`infra/terraform/main.tf`:
```hcl
terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = ">= 5.40, < 7"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

locals {
  services = [
    "run.googleapis.com",
    "firestore.googleapis.com",
    "iap.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudbuild.googleapis.com",
    "artifactregistry.googleapis.com",
    "iam.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

resource "google_firestore_database" "generator" {
  name        = var.generator_database_id
  location_id = var.firestore_location
  type        = "FIRESTORE_NATIVE"
  depends_on  = [google_project_service.enabled]
}

resource "google_artifact_registry_repository" "generator" {
  repository_id = "generator"
  location      = var.region
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

resource "google_service_account" "generator_runtime" {
  account_id   = "generator-runtime"
  display_name = "GE Demo Generator Cloud Run runtime"
  depends_on   = [google_project_service.enabled]
}

resource "google_project_iam_member" "generator_firestore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.generator_runtime.email}"
}

resource "google_cloud_run_v2_service" "generator" {
  name                = "generator"
  location            = var.region
  deletion_protection = false

  template {
    service_account = google_service_account.generator_runtime.email
    containers {
      image = var.generator_image
      ports {
        container_port = 8080
      }
      env {
        name  = "GOOGLE_CLOUD_PROJECT"
        value = var.project_id
      }
      env {
        name  = "FIRESTORE_DATABASE_ID"
        value = var.generator_database_id
      }
    }
  }

  depends_on = [
    google_project_service.enabled,
    google_project_iam_member.generator_firestore,
  ]
}
```

- [ ] **Step 3: `outputs.tf` を作成**

`infra/terraform/outputs.tf`:
```hcl
output "service_name" {
  value       = google_cloud_run_v2_service.generator.name
  description = "Cloud Run サービス名"
}

output "service_uri" {
  value       = google_cloud_run_v2_service.generator.uri
  description = "Cloud Run サービスの URL"
}

output "runtime_service_account" {
  value       = google_service_account.generator_runtime.email
  description = "Generator 実行 SA"
}

output "firestore_database" {
  value       = google_firestore_database.generator.name
  description = "Generator 用 Firestore 名前付き DB"
}

output "artifact_registry_repo" {
  value       = google_artifact_registry_repository.generator.name
  description = "Generator イメージ用 Artifact Registry リポジトリ"
}
```

- [ ] **Step 4: `README.md` を作成（apply 手順 + IAP runbook）**

`infra/terraform/README.md`:
```markdown
# Generator インフラ（Terraform）

ADR-0001 / 0003 に基づく Generator 基盤のブートストラップ。

## 前提
- gcloud CLI 認証済み（`gcloud auth login` / `gcloud auth application-default login`）
- 対象は CE/チーム共有の「デモプロジェクト」（CONTEXT.md 参照）
- Terraform >= 1.5

## 1. 初期化と apply（placeholder イメージ）
```bash
cd infra/terraform
terraform init
terraform apply -var "project_id=YOUR_PROJECT_ID"
```
初回は `generator_image` がデフォルトの hello placeholder で Cloud Run が立つ。

## 2. 実イメージのビルドと差し替え
Artifact Registry へビルドしてから image var を差し替える（Task 8 参照）:
```bash
REGION=asia-northeast1
PROJECT=YOUR_PROJECT_ID
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/generator/backend:v1"
gcloud builds submit ../../generator --tag "$IMAGE" --project "$PROJECT"
terraform apply -var "project_id=${PROJECT}" -var "generator_image=${IMAGE}"
```

## 3. IAP 有効化と閲覧者付与（gcloud runbook）
```bash
REGION=asia-northeast1
PROJECT=YOUR_PROJECT_ID
gcloud beta run services update generator \
  --region "$REGION" --project "$PROJECT" --iap
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run --service=generator --region="$REGION" \
  --project "$PROJECT" \
  --member="user:CE_EMAIL@example.com" \
  --role="roles/iap.httpsResourceAccessor"
```

## 破棄
```bash
terraform destroy -var "project_id=YOUR_PROJECT_ID"
```
```

- [ ] **Step 5: フォーマットと構文検証**

Run: `cd infra/terraform && terraform fmt && terraform init -backend=false && terraform validate`
Expected: `Success! The configuration is valid.`（`terraform init -backend=false` はプロバイダ取得のみ。実 apply は Task 8）。

- [ ] **Step 6: Commit**

```bash
git add infra/terraform/variables.tf infra/terraform/main.tf infra/terraform/outputs.tf infra/terraform/README.md
git commit -m "feat(infra): add Terraform bootstrap for generator on Cloud Run" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: デプロイ runbook と基盤の動作検証

実際にデモプロジェクトへデプロイし、(1) ローカルテスト全緑、(2) terraform apply 成功、(3) 未認証アクセスが IAP で弾かれる（302/401）、を確認する。authed-through-IAP の E2E（IAP クライアント ID を使ったトークン取得）は UI/フローが揃う Plan C で検証する（本計画ではスコープ外と明記）。

**Files:**
- Modify: `infra/terraform/README.md`（必要なら手順の追補のみ。コード変更なし）

- [ ] **Step 1: ローカルの全テストが緑であることを再確認**

Run: `cd generator && npx vitest run`
Expected: `demo` `registry` `iap` `routes.demos` が PASS、`firestore-store.int` は skipped。失敗ゼロ。

- [ ] **Step 2: イメージをビルドして Artifact Registry へ push**

Run（プレースホルダを実値に置換）:
```bash
REGION=asia-northeast1
PROJECT=YOUR_PROJECT_ID
IMAGE="${REGION}-docker.pkg.dev/${PROJECT}/generator/backend:v1"
# AR リポジトリは Task 7 の terraform apply で作成済みであること
gcloud builds submit generator --tag "$IMAGE" --project "$PROJECT"
```
Expected: ビルドが `SUCCESS`、イメージが AR に push される。

> AR リポジトリが未作成の場合は先に Task 7 Step 5 の後で `terraform apply`（README の 1.）を実行しておく。

- [ ] **Step 3: 実イメージで terraform apply**

Run:
```bash
cd infra/terraform
terraform apply -var "project_id=${PROJECT}" -var "generator_image=${IMAGE}"
```
Expected: apply 成功。`terraform output service_uri` で Cloud Run の URL が取得できる。

- [ ] **Step 4: IAP 有効化と自分への閲覧者付与**

Run:
```bash
gcloud beta run services update generator --region "$REGION" --project "$PROJECT" --iap
gcloud beta iap web add-iam-policy-binding \
  --resource-type=cloud-run --service=generator --region="$REGION" --project "$PROJECT" \
  --member="user:$(gcloud config get-value account)" \
  --role="roles/iap.httpsResourceAccessor"
```
Expected: 双方とも成功。

- [ ] **Step 5: 未認証アクセスが IAP で弾かれることを確認**

Run:
```bash
URI=$(cd infra/terraform && terraform output -raw service_uri)
curl -s -o /dev/null -w "%{http_code}\n" "$URI/healthz"
```
Expected: `302`（IAP のログイン画面へリダイレクト）または `401`。`200` が返る場合は IAP が効いていない → Step 4 を見直す。

- [ ] **Step 6: 検証結果を README に追記してコミット**

`infra/terraform/README.md` の末尾に「## 4. 動作検証」節を追記:
```markdown
## 4. 動作検証
- `cd generator && npx vitest run` が全緑（int テストは skipped）
- `terraform apply` 成功、`terraform output service_uri` で URL 取得可
- 未認証 `curl $URI/healthz` が 302/401（IAP 有効）
- 認証つき E2E（IAP トークン経由）は Plan C で検証する
```

Run:
```bash
git add infra/terraform/README.md
git commit -m "docs(infra): record generator foundation deploy verification" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage（Plan A スコープ対応）:**
- Cloud Run 上の Node.js バックエンド雛形 → Task 0, 5, 6（buildApp + server.js + Dockerfile）✅
- IAP 認証 → Task 4（ミドルウェア）, Task 8 Step 4–5（実 IAP 有効化＋検証）✅
- Firestore Demo Registry（名前付き DB「generator」）→ Task 2（Registry）, Task 3（FirestoreStore, databaseId 既定 `generator`）, Task 7（`google_firestore_database` name=generator）✅
- Terraform ブートストラップ → Task 7（API/DB/AR/SA/IAM/Run）, Task 8（apply 検証）✅
- 「空のレジストリを読み書きできる最小アプリ」→ Task 5 の読み取り API + Task 2 の register/transition（単体テストで書き込みも実証）✅
- 後続が乗る土台（状態機械・scriptGcsUri フィールド）→ Task 1（ADR-0004 の6状態）, Task 2（setScriptUri）✅

**2. Placeholder scan:** 各コードステップに完全な実装を記載。「TODO/後で/適切に」等の曖昧表現なし。Terraform・gcloud は実行可能な完全コマンド。プロジェクト ID 等の環境固有値は `YOUR_PROJECT_ID` と明示し置換を指示（隠れた省略なし）。✅

**3. Type consistency:**
- Demo フィールド（id/domain/suffix/ownerCe/goal/classification/state/scriptGcsUri/createdAt/updatedAt）は Task 1 で定義し、Task 2/3/5 のテスト・実装で一貫使用。✅
- ストアインターフェース `get/put/list`（async）は `MemoryStore`（Task 2）と `FirestoreStore`（Task 3）で同一シグネチャ。✅
- `DemoRegistry` メソッド名（register/get/list/transition/setScriptUri）は Task 2 定義と Task 5 利用で一致。✅
- `buildApp({ registry, authMiddleware })` の引数形は Task 5 定義・Task 6 結線・Task 5 テストで一致。✅
- `iapAuth({ audience, verify, devUserEmail })` は Task 4 定義・Task 6 利用で一致。✅
- 状態名（building/active/build_failed/deleting/deleted/delete_failed）は Task 1 の `DEMO_STATES` と遷移表で統一。✅

整合性の問題は検出されず。
