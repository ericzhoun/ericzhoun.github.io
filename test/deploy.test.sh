#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PUBLIC_PAYLOAD="$(mktemp)"
ADMIN_PAYLOAD="$(mktemp)"
trap 'rm -f "$PUBLIC_PAYLOAD" "$ADMIN_PAYLOAD"' EXIT

curl() {
  local argument
  for argument in "$@"; do
    if [[ "$argument" == @* ]]; then
      cp "${argument#@}" "$DEPLOY_CAPTURE_PATH"
    fi
  done
  printf '{"deployedAt":"test"}\n'
}
export -f curl

DEPLOY_CAPTURE_PATH="$PUBLIC_PAYLOAD" \
  BUTTERBASE_API_KEY=test \
  INVITATION_GMAIL_USER_ID=test-id \
  "$ROOT_DIR/backend/deploy.sh" guest-enroll >/dev/null

python3 - "$PUBLIC_PAYLOAD" <<'PY'
import json
import sys

with open(sys.argv[1]) as payload_file:
    payload = json.load(payload_file)

assert payload["name"] == "guest-enroll"
assert "INVITATION_GMAIL_USER_ID" not in payload["envVars"]
PY

DEPLOY_CAPTURE_PATH="$ADMIN_PAYLOAD" \
  BUTTERBASE_API_KEY=test \
  INVITATION_GMAIL_USER_ID=test-id \
  "$ROOT_DIR/backend/deploy.sh" admin-manage >/dev/null

python3 - "$ADMIN_PAYLOAD" <<'PY'
import json
import sys

with open(sys.argv[1]) as payload_file:
    payload = json.load(payload_file)

assert payload["name"] == "admin-manage"
assert payload["envVars"]["INVITATION_GMAIL_USER_ID"] == "test-id"
PY

printf 'deploy payload scope checks passed\n'
