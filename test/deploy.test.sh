#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TEST_TMP_ROOT="$(mktemp -d)"
PAYLOAD_TMP="$TEST_TMP_ROOT/payloads"
mkdir -p "$PAYLOAD_TMP"
trap 'rm -rf "$TEST_TMP_ROOT"' EXIT

curl() {
  local argument config_mode=false payload_path="" secret_in_arguments=false line
  for argument in "$@"; do
    [[ "$argument" == "--config" || "$argument" == "-K" ]] && config_mode=true
    [[ "$argument" == @* ]] && payload_path="${argument#@}"
    case "$argument" in
      *api-key-fixture*|*github-token-fixture*|*gmail-user-fixture*) secret_in_arguments=true ;;
    esac
  done

  if $config_mode; then
    while IFS= read -r line; do
      if [[ "$line" == 'data = "@'*'"' ]]; then
        payload_path="${line#data = \"@}"
        payload_path="${payload_path%\"}"
      fi
    done
  fi

  [[ -n "$payload_path" && -f "$payload_path" ]] || {
    printf 'mock curl did not receive a readable payload path\n' >&2
    return 96
  }

  local payload_name mode
  payload_name="$(python3 - "$payload_path" <<'PY'
import json
import sys
with open(sys.argv[1]) as payload_file:
    print(json.load(payload_file)["name"])
PY
)"
  mode="$(python3 - "$payload_path" <<'PY'
import os
import sys
print(oct(os.stat(sys.argv[1]).st_mode & 0o777)[2:])
PY
)"
  cp "$payload_path" "$DEPLOY_CAPTURE_DIR/$payload_name.json"
  printf '%s|%s|%s\n' "$payload_path" "$mode" "$secret_in_arguments" >> "$DEPLOY_META_PATH"
  printf '%s\n' "${CURL_TEST_RESPONSE:-{\"deployedAt\":\"test\"}}"
}
export -f curl

assert_payload_removed() {
  local metadata_path="$1" payload_path
  while IFS='|' read -r payload_path _; do
    [[ ! -e "$payload_path" ]] || {
      printf 'payload was not removed: %s\n' "$payload_path" >&2
      return 1
    }
  done < "$metadata_path"
}

assert_unknown_selection_rejected() {
  local label="$1"
  shift
  local capture="$TEST_TMP_ROOT/$label-capture"
  local metadata="$TEST_TMP_ROOT/$label-meta"
  local mktemp_marker="$TEST_TMP_ROOT/$label-mktemp-called"
  local log="$TEST_TMP_ROOT/$label-log"
  local failed=false
  mkdir -p "$capture"
  : > "$metadata"

  if (
    export DEPLOY_MKTEMP_MARKER="$mktemp_marker"
    mktemp() {
      printf 'called\n' >> "$DEPLOY_MKTEMP_MARKER"
      command mktemp "$@"
    }
    export -f mktemp
    DEPLOY_CAPTURE_DIR="$capture" \
    DEPLOY_META_PATH="$metadata" \
    TMPDIR="$PAYLOAD_TMP" \
    BUTTERBASE_API_KEY=api-key-fixture \
      "$ROOT_DIR/backend/deploy.sh" "$@" >"$log" 2>&1
  ); then
    printf '%s selection unexpectedly succeeded\n' "$label" >&2
    failed=true
  fi
  if [[ -e "$mktemp_marker" ]]; then
    printf '%s selection created a temporary payload\n' "$label" >&2
    failed=true
  fi
  if [[ -s "$metadata" ]]; then
    printf '%s selection called curl\n' "$label" >&2
    failed=true
  fi
  if [[ -n "$(find "$capture" -type f -print -quit)" ]]; then
    printf '%s selection captured a deployment payload\n' "$label" >&2
    failed=true
  fi
  if ! rg -q 'error: unknown function: typo-function' "$log"; then
    printf '%s selection did not report the unknown function\n' "$label" >&2
    failed=true
  fi
  if rg -q 'api-key-fixture|github-token-fixture|gmail-user-fixture' "$log"; then
    printf '%s selection diagnostic exposed fixture authorization material\n' "$label" >&2
    failed=true
  fi
  ! $failed
}

unknown_failures=0
assert_unknown_selection_rejected all-unknown typo-function || unknown_failures=$((unknown_failures + 1))
assert_unknown_selection_rejected mixed-unknown claim-enrollments typo-function || unknown_failures=$((unknown_failures + 1))
if [[ $unknown_failures -ne 0 ]]; then
  printf '%s unknown-selection checks failed\n' "$unknown_failures" >&2
  exit 1
fi

ALL_CAPTURE="$TEST_TMP_ROOT/all-capture"
ALL_META="$TEST_TMP_ROOT/all-meta"
mkdir -p "$ALL_CAPTURE"
: > "$ALL_META"

DEPLOY_CAPTURE_DIR="$ALL_CAPTURE" \
DEPLOY_META_PATH="$ALL_META" \
TMPDIR="$PAYLOAD_TMP" \
BUTTERBASE_API_KEY=api-key-fixture \
GITHUB_TOKEN=github-token-fixture \
INVITATION_GMAIL_USER_ID=gmail-user-fixture \
  "$ROOT_DIR/backend/deploy.sh" >/dev/null

python3 - "$ALL_CAPTURE" "$ALL_META" "$PAYLOAD_TMP" <<'PY'
import json
import os
import pathlib
import sys

capture_dir = pathlib.Path(sys.argv[1])
meta_path = pathlib.Path(sys.argv[2])
payload_tmp = pathlib.Path(sys.argv[3]).resolve()

configured = {
    "guest-enroll", "claim-enrollments", "complete-registration",
    "class-availability", "enroll-guard", "stripe-webhook",
    "sync-enrollment-payment", "manage-account", "manage-students",
    "manage-artwork", "admin-manage", "sync-student-ages",
    "trigger-schedule-bake",
}
service_consumers = {
    "admin-manage", "enroll-guard", "guest-enroll", "manage-account",
    "manage-artwork", "trigger-schedule-bake",
}

payload_files = {path.stem: path for path in capture_dir.glob("*.json")}
assert set(payload_files) == configured, (set(payload_files), configured)
metadata = [line.split("|") for line in meta_path.read_text().splitlines()]
assert len(metadata) == len(configured), metadata
paths = {entry[0] for entry in metadata}
assert len(paths) == 1, paths
payload_path = pathlib.Path(next(iter(paths)))
assert payload_path.parent.resolve() == payload_tmp, (payload_path.parent.resolve(), payload_tmp)
assert payload_path.name.startswith("olivistart-bb-deploy."), payload_path.name
assert str(payload_path) != "/tmp/bb-deploy-payload.json", payload_path
assert {entry[1] for entry in metadata} == {"600"}, metadata
assert {entry[2] for entry in metadata} == {"false"}, metadata

for name, path in payload_files.items():
    with path.open() as payload_file:
        env_vars = json.load(payload_file)["envVars"]
    assert ("SERVICE_KEY" in env_vars) == (name in service_consumers), name
    assert ("GITHUB_TOKEN" in env_vars) == (name == "trigger-schedule-bake"), name
    assert ("INVITATION_GMAIL_USER_ID" in env_vars) == (name == "admin-manage"), name
PY
assert_payload_removed "$ALL_META"

SECOND_CAPTURE="$TEST_TMP_ROOT/second-capture"
SECOND_META="$TEST_TMP_ROOT/second-meta"
mkdir -p "$SECOND_CAPTURE"
: > "$SECOND_META"
DEPLOY_CAPTURE_DIR="$SECOND_CAPTURE" \
DEPLOY_META_PATH="$SECOND_META" \
TMPDIR="$PAYLOAD_TMP" \
BUTTERBASE_API_KEY=api-key-fixture \
  "$ROOT_DIR/backend/deploy.sh" claim-enrollments >/dev/null
assert_payload_removed "$SECOND_META"

first_path="$(head -n 1 "$ALL_META" | cut -d'|' -f1)"
second_path="$(head -n 1 "$SECOND_META" | cut -d'|' -f1)"
[[ "$first_path" != "$second_path" ]] || {
  printf 'separate deploy runs reused a payload path\n' >&2
  exit 1
}

FAIL_CAPTURE="$TEST_TMP_ROOT/fail-capture"
FAIL_META="$TEST_TMP_ROOT/fail-meta"
FAIL_LOG="$TEST_TMP_ROOT/fail-log"
mkdir -p "$FAIL_CAPTURE"
: > "$FAIL_META"
if DEPLOY_CAPTURE_DIR="$FAIL_CAPTURE" \
   DEPLOY_META_PATH="$FAIL_META" \
   CURL_TEST_RESPONSE='{"error":"simulated"}' \
   TMPDIR="$PAYLOAD_TMP" \
   BUTTERBASE_API_KEY=api-key-fixture \
     "$ROOT_DIR/backend/deploy.sh" guest-enroll >"$FAIL_LOG" 2>&1; then
  printf 'failed deploy unexpectedly succeeded\n' >&2
  exit 1
fi
assert_payload_removed "$FAIL_META"
if rg -q 'api-key-fixture|github-token-fixture|gmail-user-fixture' "$FAIL_LOG"; then
  printf 'failure output exposed fixture authorization material\n' >&2
  exit 1
fi

INVALID_TEMP_PATH="$TEST_TMP_ROOT/not-an-approved-payload"
printf 'sentinel\n' > "$INVALID_TEMP_PATH"
export INVALID_TEMP_PATH
if (
  mktemp() { printf '%s\n' "$INVALID_TEMP_PATH"; }
  export -f mktemp
  DEPLOY_CAPTURE_DIR="$TEST_TMP_ROOT" \
  DEPLOY_META_PATH="$TEST_TMP_ROOT/invalid-meta" \
  TMPDIR="$PAYLOAD_TMP" \
  BUTTERBASE_API_KEY=api-key-fixture \
    "$ROOT_DIR/backend/deploy.sh" claim-enrollments >/dev/null 2>&1
); then
  printf 'deploy accepted an unvalidated temporary payload path\n' >&2
  exit 1
fi
[[ -f "$INVALID_TEMP_PATH" && "$(<"$INVALID_TEMP_PATH")" == "sentinel" ]] || {
  printf 'invalid temporary path was deleted or modified\n' >&2
  exit 1
}

FAIL_FAST_CAPTURE="$TEST_TMP_ROOT/fail-fast-capture"
FAIL_FAST_META="$TEST_TMP_ROOT/fail-fast-meta"
mkdir -p "$FAIL_FAST_CAPTURE"
: > "$FAIL_FAST_META"

if DEPLOY_CAPTURE_DIR="$FAIL_FAST_CAPTURE" DEPLOY_META_PATH="$FAIL_FAST_META" \
   TMPDIR="$PAYLOAD_TMP" BUTTERBASE_API_KEY=api-key-fixture \
   env -u INVITATION_GMAIL_USER_ID -u GITHUB_TOKEN \
     "$ROOT_DIR/backend/deploy.sh" admin-manage >/dev/null 2>&1; then
  printf 'admin-manage deploy accepted missing Gmail user id\n' >&2
  exit 1
fi
if DEPLOY_CAPTURE_DIR="$FAIL_FAST_CAPTURE" DEPLOY_META_PATH="$FAIL_FAST_META" \
   TMPDIR="$PAYLOAD_TMP" BUTTERBASE_API_KEY=api-key-fixture \
   env -u GITHUB_TOKEN -u INVITATION_GMAIL_USER_ID \
     "$ROOT_DIR/backend/deploy.sh" trigger-schedule-bake >/dev/null 2>&1; then
  printf 'trigger-schedule-bake deploy accepted missing GitHub token\n' >&2
  exit 1
fi
[[ ! -s "$FAIL_FAST_META" ]] || {
  printf 'fail-fast validation called curl\n' >&2
  exit 1
}

ADMIN_ONLY_CAPTURE="$TEST_TMP_ROOT/admin-only-capture"
ADMIN_ONLY_META="$TEST_TMP_ROOT/admin-only-meta"
mkdir -p "$ADMIN_ONLY_CAPTURE"
: > "$ADMIN_ONLY_META"
DEPLOY_CAPTURE_DIR="$ADMIN_ONLY_CAPTURE" DEPLOY_META_PATH="$ADMIN_ONLY_META" \
TMPDIR="$PAYLOAD_TMP" BUTTERBASE_API_KEY=api-key-fixture \
INVITATION_GMAIL_USER_ID=gmail-user-fixture \
env -u GITHUB_TOKEN \
  "$ROOT_DIR/backend/deploy.sh" admin-manage >/dev/null

TRIGGER_ONLY_CAPTURE="$TEST_TMP_ROOT/trigger-only-capture"
TRIGGER_ONLY_META="$TEST_TMP_ROOT/trigger-only-meta"
mkdir -p "$TRIGGER_ONLY_CAPTURE"
: > "$TRIGGER_ONLY_META"
DEPLOY_CAPTURE_DIR="$TRIGGER_ONLY_CAPTURE" DEPLOY_META_PATH="$TRIGGER_ONLY_META" \
TMPDIR="$PAYLOAD_TMP" BUTTERBASE_API_KEY=api-key-fixture \
GITHUB_TOKEN=github-token-fixture \
env -u INVITATION_GMAIL_USER_ID \
  "$ROOT_DIR/backend/deploy.sh" trigger-schedule-bake >/dev/null

printf 'deploy payload security and scope checks passed\n'
