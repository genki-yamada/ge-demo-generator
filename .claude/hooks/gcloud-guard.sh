#!/bin/sh
# PreToolUse guard (Bash/WebFetch).
#
# 目的:
#  - ローカル gcloud config を変更するコマンドを禁止する（既定プロジェクト等を勝手に書き換えない）。
#  - リソースを操作する gcloud コマンドでは、プロジェクトを毎回明示（--project）させる。
#    config の既定プロジェクトに依存した実行を禁止する。
#
# 仕様: stdin でツール呼び出しの JSON を受け取り、ルールに合致したら deny の JSON を
#       出力して exit 0。合致しなければ何も出力しない（allow）。
#
# 注意: これは厳密なパーサではなくガードレール。&& 連結など複合コマンドでは
#       先頭の gcloud サブコマンドで判定するため、すり抜ける余地はある。

IN=$(cat)

deny() {
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$1"
  exit 0
}

# Rule G1: ローカル gcloud config の変更を禁止。
if printf '%s' "$IN" | grep -qiE 'gcloud[[:space:]]+(init|config[[:space:]]+(set|unset)|config[[:space:]]+configurations[[:space:]]+(create|activate|delete|rename))'; then
  deny "gcloud のローカル config 変更 (config set/unset/configurations/init) は禁止です。config は変更せず、コマンドごとに --project ge-work-osaka を指定してください。"
fi

# Rule G2: gcloud でリソースを操作する場合はプロジェクトを毎回明示させる。
if printf '%s' "$IN" | grep -qi 'gcloud'; then
  # プロジェクト指定が不要な（既定プロジェクトに依存しない）サブコマンドは許可。
  if printf '%s' "$IN" | grep -qiE 'gcloud[[:space:]]+(--version|version|help|topic|info|auth|components|emulators|projects|config[[:space:]]+(get-value|list|get))'; then
    :
  elif printf '%s' "$IN" | grep -qiE '\-\-project([= ]|$)'; then
    :
  else
    deny "gcloud コマンドはプロジェクトを毎回明示してください (例: --project ge-work-osaka)。ローカル config の既定プロジェクトに依存する実行は禁止です。"
  fi
fi

exit 0
