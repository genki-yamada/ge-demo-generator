# Vertex Agent Engine 名をGCSに保存してヘッドレスCleanupで削除する

## 背景

ADR-0004 の「生成スクリプトをGCSに保存し、Cleanup はそのスクリプトの再実行で行う」方式を実装した結果、
生成スクリプト自体のヘッドレス化（`deinteractivize`）とCleanupの仕組みは実GCPで動作実証された。
ところが実E2Eテストで、**Vertex Agent Engine（Sandbox）だけが削除されずにオーファンとして残る**問題が発生した。
1回の検証サイクルで11件のオーファンエンジンが残留し、手動でAiPlatform REST APIを叩いて全件削除する作業が必要になった。

根本原因は次の通り。生成スクリプトは Agent Engine 名を `~/<dirName>/.env` の `AGENT_ENGINE_NAME=` 行に書き出す。
スクリプトの `--cleanup` パスはその行を読み込んで Agent Engine を `force=true` で削除する設計になっている。
しかし **Build と Cleanup は別々の Cloud Run Job コンテナで実行される**。Build コンテナが終了した時点でそのコンテナの
ファイルシステムは消滅するため、Cleanup コンテナは `.env` を見つけられず、Agent Engine の削除をスキップする。

## 検討した選択肢

### 案A: 生成スクリプトの `--cleanup` ロジックを修正して環境変数から直接読む

生成スクリプトが `~/<dirName>/.env` を読む代わりに `$AGENT_ENGINE_NAME` 環境変数を直接参照するよう変更し、
Job 起動時にその値を渡す方式。

**却下理由が2点ある。**

1. **バイト等価性（golden test）の破壊**：ADR-0002 の「bash スクリプトをそのまま温存して移植する」方針のもと、
   生成スクリプトの中身は元GASコードの忠実なポートであることをgoldenテストで担保している。スクリプト本体を
   変更するとそのテストが崩れ、「移植の同一性」という前提が失われる。
2. **Build時の取得問題が残る**：Cleanup実行時に Agent Engine 名をJob環境変数として渡すには、その値をどこかに
   保存しておく仕組みが結局必要になる。スクリプトを修正しても情報の永続化問題は解決しない。

### 案B（採用）: Job entrypoint がGCSへ persist/restore する

**生成スクリプト本体は一切変更せず**、provisioner の Job entrypoint（`generator/provisioner/entrypoint.sh`）だけを
変更する。

- **Build 完了後**: entrypoint がスクリプト終了後に `$HOME/$DEMO_DIR/.env` から `AGENT_ENGINE_NAME=` の行だけを
  抽出し、`$ENV_REF`（= `gs://<bucket>/envs/<demoId>.env`）にアップロードする。
- **Cleanup 実行前**: entrypoint が `$ENV_REF` をダウンロードして `$HOME/$DEMO_DIR/.env` に書き込んでから
  スクリプトを起動する。スクリプトは変更なく `.env` から Agent Engine 名を読み、削除処理を行う。

## 決定

**案Bを採用する。**

## 実装の詳細と不変条件

- **`dirName === demo.id` 不変条件**：生成スクリプトが使う `dirName` は `makeDemoId(domain, suffix)` の返り値
  （`demo-<domain>-<suffix>` 形式）と常に等しい。`DEMO_DIR` ジョブ環境変数には `demo.id` を渡すことで、
  entrypoint がスクリプトと同じパスを参照できる。
- **最小データ保存**：永続化するのは `.env` 全体ではなく `AGENT_ENGINE_NAME=` の1行のみ。
  `.env` はその他のAPIキーや認証情報を含む可能性があり、全体を外部ストレージに書き出すのはデータミニマイゼーション上
  望ましくない。
- **ベストエフォート動作**：persist（Build後）・restore（Cleanup前）のいずれも失敗してもJob全体を失敗させない。
  persist に失敗した場合はCleanupが従来通り Agent Engine をスキップするだけ（現状維持）。restore に失敗した場合も
  スクリプトは既存の警告付きスキップで exit 0 する。
- **`DEMO_DIR` / `ENV_REF` の注入**：両変数は `job-runner.js` が Job 起動時の環境変数オーバーライドとして設定する
  （オプション・後方互換）。`scriptStore.envRef(demoId)` が GCS URI を生成し、`scriptStore.removeEnv(demoId)` が
  Cleanup 成功後のオブジェクト削除に使われる。
- **Cleanup 後の後始末**：`cleanup-runner.js` は Cleanup Job 成功後に `envRef` オブジェクトをベストエフォートで削除する。

## 結果と影響

### 良い面

- **生成スクリプト本体に手を加えない**：goldenテスト・移植同一性が維持される（ADR-0002の方針を守る）。
- **オーファンエンジンの解消**：本変更以降に生成されたデモのCleanupは Agent Engine を自動削除するため、
  手動でAiPlatform REST APIを叩く作業が不要になる。
- **ADR-0004 のモデルとの一貫性**：「スクリプト本体は変えず、entrypoint 層でコンテナ間の状態ギャップを吸収する」
  という考え方は、ADR-0004 が確立した「bash 温存・Job 再実行」モデルの自然な延長である。

### 注意事項・制限

- **本変更より前に生成されたデモへの非適用**：旧デモのCleanupは引き続き Agent Engine をスキップする（従来動作）。
  旧デモを削除する場合は AiPlatform REST API による手動削除が必要。
- **runner SA に scripts バケットへの書き込み権限が必要**：persist ステップが `gsutil cp` で書き込むため、
  runner SA は `roles/storage.objectAdmin`（または相当）が必要。読み取り専用（`objectViewer`）では不足する。
- **`dirName === demo.id` 不変条件の維持**：`makeDemoId` の命名規則を変更する場合は entrypoint の仮定が崩れないか
  確認が必要。

## 関連

- ADR-0002: bash スクリプト温存・Job 実行の基本方針
- ADR-0004: 生成スクリプトをGCSに保存しCleanupはスクリプト再実行で行う（本ADRが前提とする仕組み）
