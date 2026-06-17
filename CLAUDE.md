# CLAUDE.md

## リポジトリ運用ルール（最重要・厳守）

このプロジェクトは `https://github.com/ryotat7/ge-demo-generator`（以下「元リポジトリ」）から
フォークした **`https://github.com/genki-yamada/ge-demo-generator`（フォーク）** で管理する。

- **元リポジトリ `ryotat7/ge-demo-generator` への参照・書き込みを一切行わないこと。**
  - `git remote add` / `git push` / `git pull` / `git fetch` / `git clone` 等で元リポジトリの
    URL（HTTPS・SSH いずれの形式も）を指定してはならない。
  - WebFetch 等で元リポジトリの GitHub ページを取得してはならない。
  - upstream として元リポジトリを追加することも禁止する。
- Git 操作（push / pull / fetch 等）は **すべてフォーク `genki-yamada/ge-demo-generator`（`origin`）** に対してのみ行う。
- 上記は誤操作防止のため `.claude/settings.json` の PreToolUse フックでも機械的にブロックしている
  （`ryotat7` を含む Bash / WebFetch 呼び出しは拒否される）。フックを無効化・回避しないこと。

## プロジェクト概要

GE Demo Generator — 顧客の業務課題から Gemini Enterprise 向けのデモ用 AI エージェントと
合成データ一式を Google Cloud 上に構築するアクセラレーター。
詳細は `README.md` / `ARCHITECTURE.md` / `設計書.md` / `CONTEXT.md`、設計判断は `docs/adr/` を参照。
