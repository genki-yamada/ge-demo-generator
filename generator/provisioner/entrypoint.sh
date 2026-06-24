#!/bin/sh
set -e

: "${SCRIPT_REF:?SCRIPT_REF env required}"

gsutil cp "$SCRIPT_REF" /tmp/run.sh
chmod +x /tmp/run.sh

# Detect --cleanup mode
_cleanup=0
for _a in "$@"; do
  if [ "$_a" = "--cleanup" ]; then
    _cleanup=1
    break
  fi
done

if [ "$_cleanup" = "1" ]; then
  # CLEANUP mode: restore persisted env before running script (best-effort)
  if [ -n "${ENV_REF:-}" ] && [ -n "${DEMO_DIR:-}" ]; then
    mkdir -p "$HOME/$DEMO_DIR" 2>/dev/null || true
    gsutil cp "$ENV_REF" "$HOME/$DEMO_DIR/.env" 2>/dev/null \
      || echo "[entrypoint] notice: could not restore $ENV_REF — skipping (Agent Engine name may be unavailable)"
  fi
  exec bash /tmp/run.sh "$@"
else
  # BUILD mode: run script, capture exit code
  set +e
  bash /tmp/run.sh "$@"
  rc=$?
  set -e

  # Persist AGENT_ENGINE_NAME line to GCS (best-effort, never changes rc)
  if [ "$rc" = "0" ] && [ -n "${ENV_REF:-}" ] && [ -n "${DEMO_DIR:-}" ]; then
    _envfile="$HOME/$DEMO_DIR/.env"
    if [ -f "$_envfile" ]; then
      _tmpenv="/tmp/agent_engine_name_$$.env"
      if grep '^AGENT_ENGINE_NAME=' "$_envfile" > "$_tmpenv" 2>/dev/null && [ -s "$_tmpenv" ]; then
        gsutil cp "$_tmpenv" "$ENV_REF" 2>/dev/null \
          || echo "[entrypoint] notice: could not upload AGENT_ENGINE_NAME to $ENV_REF"
      else
        echo "[entrypoint] notice: AGENT_ENGINE_NAME not found in $_envfile — skipping persist"
      fi
      rm -f "$_tmpenv"
    fi
  fi

  exit $rc
fi
