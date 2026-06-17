# Demo の生成スクリプトを GCS に保存し、Cleanup はそのスクリプトの再実行で行う

## 背景

共有デモプロジェクトに Demo を作り続けると、Cloud Run サービス数・BigQuery データセット数・Firestore 等のプロジェクト単位クォータにいずれ当たる（Demo 累積問題）。対策として、CE が UI から手動選択した Demo を削除する機能を追加する。

各 Demo の生成スクリプトには既に `--cleanup` モードが内蔵されており、その Demo に紐づく全リソース（BigQuery データセット、Maps API キー、Cloud Run メイン／Viewer、Firestore コレクション、GE 登録、Agent Engine サンドボックス、Pub/Sub、Cloud Scheduler、Secret Manager、タスクコレクション）を削除できる。ただし現状は対話的（`read -p`）で、スクリプトとディレクトリがローカル（`~/<dirName>`）に存在する前提になっている。新アーキテクチャ（ADR-0001）では Cloud Run 上の Generator が後からいつでも Cleanup を起動できる必要があり、「Cleanup を実行するための成果物をどこから入手するか」を決める必要があった。

## 決定

Demo 生成時に、**その Demo を構築した生成スクリプトそのものを GCS バケットに保存**する。Cleanup は、保存済みスクリプトを取得して `--cleanup` を **ヘッドレス Job で非対話実行**する（ADR-0002 と同じ「bash を温存し Job で流す」方式）。Firestore の Demo Registry には、生成スクリプトの GCS URI とライフサイクル状態を持たせる。

Demo Registry のレコードは **構築開始時** に作成し、`building / active / build_failed / deleting / deleted / delete_failed` のフル状態を持つ。`deleted` は tombstone として残す。

## 理由とトレードオフ

- **drift を避ける**：cleanup ロジックは Demo 識別子から導出可能だが、作成時と削除時で Generator のコードが変わると、再生成した cleanup が実際に作られたリソースと食い違う恐れがある。構築に使ったスクリプトをそのまま保存・再実行すれば、削除対象が常に作成物と一致する（生成された MCP シークレット名なども含めてずれない）。
- **保存先に GCS を選ぶ理由**：生成スクリプトは CSV データと全 Python ソースをヒアドキュメントで埋め込むため数百 KB〜数 MB になり、Firestore の 1 MiB ドキュメント上限を超えうる。GCS はサイズ上限がなくバージョニングも効く。
- **構築開始時に登録する理由（オーファン防止）**：構築は途中失敗で部分的にリソースを残しうる。成功時のみ登録すると、それらが Registry に出ず cleanup できないオーファンになり、累積問題の解決にならない。開始時に登録することで `build_failed` の部分リソースも UI から cleanup できる。

## Considered Options

- **識別子だけ保存し cleanup を都度再生成**：軽量だが上記 drift リスクのため却下。
- **スクリプトに依存しない汎用 cleanup ルーチンを別実装**：削除ロジックを二重管理することになり、ADR-0002 の「bash 温存」方針からも外れるため却下。
