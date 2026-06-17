# GE Demo Generator

顧客の業務課題を入力すると、Gemini Enterprise 上で使えるデモ用 AI エージェントと合成データ一式を Google Cloud 上に構築するアクセラレーター。本書は本プロジェクト固有の用語集である（実装の詳細は含めない）。

## Language

**Generator（ジェネレーター）**:
デモ環境を生み出すツール本体。CE が操作し、データ・指示文・デプロイ成果物を生成する。現在は Google Apps Script 製。GAS を廃止し Cloud Run へ移行する計画が進行中。
_Avoid_: アプリ、ツール（曖昧なとき）

**Demo Project（デモプロジェクト）**:
Generator とすべての Demo を同居させる、CE/チームが所有する単一の専用 GCP プロジェクト。顧客ごとには分けず、Demo は内部で名前空間分離する。
_Avoid_: 顧客プロジェクト、本番プロジェクト（別概念）

**Demo（デモ）**:
1つの顧客シナリオ向けに合成された環境一式（BigQuery データ + Firestore + エージェント + Data Viewer）。`demo-<domain>-<suffix>` で識別・名前空間分離される。
_Avoid_: 環境、案件（曖昧なとき）

**CE（カスタマーエンジニア）**:
Generator を操作してプリセールスのデモを準備する社内ユーザー。Demo Project の所有者。
_Avoid_: ユーザー（顧客と紛らわしいとき）

**Cleanup（クリーンアップ）**:
1つの Demo とそれに紐づく全リソース（BigQuery データセット、Cloud Run、Firestore、GE 登録、Secret、Pub/Sub、Scheduler 等）を削除する操作。「Demo を削除する」とは、その Demo の Cleanup を起動することと同義。
_Avoid_: 削除、デリート（操作名としては Cleanup に統一）

**Demo Registry（デモレジストリ）**:
Demo Project に存在する各 Demo の単一の記録。生成メタデータ（所有 CE・ゴール・生成日時・分類等）とライフサイクル状態を併せ持つ唯一の真実源で、CE はこれを見て Demo を選択・管理・Cleanup し、利用統計やアクティビティ表示もこれを参照する。Demo 1件につき1レコード。
_Avoid_: 履歴、ヒストリー、利用ログ（いずれも Demo Registry に統合され、別概念としては存在しない）

## 関係

- **Generator → Demo**: Generator が Demo を生成・構築する（1 Generator が多数の Demo を生む）。
- **Demo Project ⊃ Generator, Demo**: Demo Project は Generator と全 Demo を内包する。両者は同一プロジェクト内 SA を共有しうるため、構築時にプロジェクト境界をまたがない。

## 会話例

> **CE**: 「この案件のデモを作りたい」
> **Dev**: 「それは新しい *Demo* を1つ *Demo Project* の中に立てる、ということですね。*Demo Project* は使い回す前提なので、*Generator* 自体を再デプロイする必要はありません」
> **CE**: 「構築は誰の権限で走るの？」
> **Dev**: 「*Generator* が *Demo Project* 内に居るので、その SA がそのまま BigQuery や Cloud Run を作れます。顧客プロジェクトを触るわけではないので、外部への権限付与は不要です」
