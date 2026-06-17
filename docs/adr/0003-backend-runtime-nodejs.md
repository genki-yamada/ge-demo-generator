# Generator バックエンドを Node.js で実装する

## 背景

Generator を Cloud Run へ移行（ADR-0001）するにあたり、バックエンドの実行言語を決める必要があった。合成されるデモエージェント側は Python / ADK で書かれているため、リポジトリ全体の言語統一を狙うなら Python が自然に見える。

## 決定

Generator バックエンドは **Node.js on Cloud Run** で実装する（Python ではなく）。

## 理由とトレードオフ

- **escaping 資産の原型保存**：本体の大半を占める `generateSetupScript` は JavaScript のテンプレートリテラルと文字列連結の塊で、多層エスケープ（AGENTS.md §2）が JS のエスケープ規則に強く依存している。Node へはほぼ原型移植でき、置換が要る GAS 固有 API は約47箇所のみ（`PropertiesService`→env/Secret Manager、`UrlFetchApp`+`ScriptApp.getOAuthToken`→`fetch`+ADC、`SpreadsheetApp`→Firestore、`HtmlService`→静的配信、`Session.getActiveUser`→IAP ヘッダ、`DriveApp`→GCS、`Utilities.*`→Node 標準）。
- **Python 統一を選ばない理由**：codegen の文字列ロジックを Python で書き直すと、AGENTS.md が記録する escaping バグを別言語の規則で再発させるリスクが高い。エージェントコードは「テキストとして生成される」ものでありインポートされないため、言語統一による実利はほとんどない。

## 影響

- リポジトリは Node（Generator）と Python（生成されるエージェント）の2言語構成になるが、両者は生成する側／生成される側の関係であり結合しないため許容する。
