#!/usr/bin/env bash
# Deploy Butterbase serverless functions from backend/functions/.
#
# Usage:
#   BUTTERBASE_API_KEY=bb_sk_... ./backend/deploy.sh [function-name ...]
#
# With no arguments, deploys every configured function. The service key is
# read from the environment and must never be committed to this repo.
#
# Targets app_0otd4vmczvu8 (olivista-studio) by default. Override APP_ID to
# deploy elsewhere, e.g. APP_ID=app_48ul5eszfv7v (herfield, retired); the key
# in BUTTERBASE_API_KEY must belong to whichever app is targeted.
set -euo pipefail

APP_ID="${APP_ID:-app_0otd4vmczvu8}"
API_BASE="https://api.butterbase.ai"
DIR="$(cd "$(dirname "$0")/functions" && pwd)"

if [[ -z "${BUTTERBASE_API_KEY:-}" ]]; then
  echo "error: set BUTTERBASE_API_KEY in the environment" >&2
  exit 1
fi

# name|auth|path|impersonation|description
CONFIGS=(
  "guest-enroll|none|/guest-enroll|false|Guest checkout: unclaimed pending enrollment + Stripe Checkout session. Public endpoint; pricing computed server-side."
  "claim-enrollments|required|/claim-enrollments|false|Attaches unclaimed enrollments to the caller by verified email match."
  "complete-registration|required|/complete-registration|false|Saves the post-payment registration form for an enrollment the caller owns."
  "class-availability|none|/class-availability|false|Public seat availability (confirmed + fresh pending holds) for a schedule."
  "enroll-guard|required|/enroll|false|Logged-in enrollment with server-side pricing, dynamic product, and Stripe Checkout. Redirect URLs point to the static olivistart.com frontend."
  "stripe-webhook|none|/stripe-webhook|false|Payment fulfillment: re-verifies order status via the billing API, then confirms enrollment and creates home bookings. Idempotent.",
  "sync-enrollment-payment|required|/sync-enrollment-payment|false|On-demand payment sync: reads order status from the billing API as the caller and confirms the enrollment if paid. Called by account/checkout-success pages since billing has no webhook forward.",
  "manage-account|required|/manage-account|false|Account management: persist verified parent profiles with server-only service access, update contact info on own enrollments, and change password via forgot/reset-password email-code flow.",
  "manage-students|required|/manage-students|false|Student profile CRUD. Parents manage their own children; admin can manage any.",
  "manage-artwork|required|/manage-artwork|false|Artwork photo lifecycle: presigned upload/download URLs and delete, gated on student ownership. Storage calls use the service key."
  "admin-manage|required|/admin-manage|false|Admin-only: create parent accounts, manage their students, grant comped enrollments, and adjust credits. Re-verifies the caller against /auth/me and the admin allowlist; reads and writes go through the REST data API with SERVICE_KEY because students/enrollments are behind user-isolation RLS that ctx.db cannot cross."
  "sync-student-ages|none||false|Refreshes enrollment ages from dates of birth once a day."
  "trigger-schedule-bake|none|/trigger-schedule-bake|false|Admin-only (checked against the service key, not ctx.user): dispatches the bake-schedule GitHub Actions workflow to refresh schedule.html's baked snapshot on demand."
)

selected=("$@")
if [[ ${#selected[@]} -gt 0 ]]; then
  matched_configurations=0
  for selected_name in "${selected[@]}"; do
    known_selection=false
    for cfg in "${CONFIGS[@]}"; do
      IFS='|' read -r configured_name _ <<<"$cfg"
      if [[ "$selected_name" == "$configured_name" ]]; then
        known_selection=true
        matched_configurations=$((matched_configurations + 1))
        break
      fi
    done
    if ! $known_selection; then
      printf 'error: unknown function: %s\n' "$selected_name" >&2
      exit 1
    fi
  done
  if [[ $matched_configurations -eq 0 ]]; then
    echo "error: no configured functions matched the supplied selections" >&2
    exit 1
  fi
fi

selection_includes() {
  local target="$1" selected_name
  [[ ${#selected[@]} -eq 0 ]] && return 0
  for selected_name in "${selected[@]}"; do
    [[ "$selected_name" == "$target" ]] && return 0
  done
  return 1
}

if selection_includes "admin-manage" && [[ -z "${INVITATION_GMAIL_USER_ID:-}" ]]; then
  echo "error: set INVITATION_GMAIL_USER_ID when deploying admin-manage" >&2
  exit 1
fi
if selection_includes "trigger-schedule-bake" && [[ -z "${GITHUB_TOKEN:-}" ]]; then
  echo "error: set GITHUB_TOKEN when deploying trigger-schedule-bake" >&2
  exit 1
fi
ADMIN_EMAILS_FILE="$(cd "$(dirname "$0")" && pwd)/admin-emails.json"
if ! [[ -s "$ADMIN_EMAILS_FILE" ]]; then
  echo "error: $ADMIN_EMAILS_FILE is missing; it is the admin allowlist" >&2
  exit 1
fi

TMP_BASE="$(cd "${TMPDIR:-/tmp}" && pwd -P)"
PAYLOAD_PREFIX="$TMP_BASE/olivistart-bb-deploy."
PAYLOAD_FILE=""
PAYLOAD_VALID=false
cleanup_payload() {
  if $PAYLOAD_VALID && [[ "$PAYLOAD_FILE" == "$PAYLOAD_PREFIX"?????? ]]; then
    rm -f -- "$PAYLOAD_FILE"
  fi
}
trap cleanup_payload EXIT

PAYLOAD_FILE="$(mktemp "${PAYLOAD_PREFIX}XXXXXX")"
if [[ "$PAYLOAD_FILE" != "$PAYLOAD_PREFIX"?????? || ! -f "$PAYLOAD_FILE" || -L "$PAYLOAD_FILE" ]]; then
  echo "error: mktemp returned an invalid deploy payload path" >&2
  exit 1
fi
PAYLOAD_VALID=true
chmod 600 "$PAYLOAD_FILE"
python3 - "$PAYLOAD_FILE" <<'PY'
import os
import stat
import sys

path = sys.argv[1]
mode = stat.S_IMODE(os.stat(path, follow_symlinks=False).st_mode)
if mode != 0o600 or not stat.S_ISREG(os.stat(path, follow_symlinks=False).st_mode):
    raise SystemExit("deploy payload permissions are not private")
PY

deploy_one() {
  local name="$1" auth="$2" path="$3" impersonation="$4" desc="$5" cron="${6:-}"
  local file="$DIR/$name.js"
  [[ -f "$file" ]] || { echo "error: $file not found" >&2; return 1; }

  python3 - "$name" "$auth" "$path" "$impersonation" "$desc" "$cron" "$file" <<'PY' > "$PAYLOAD_FILE"
import json, os, sys
name, auth, path, impersonation, desc, cron, file = sys.argv[1:8]
triggers = []
if path:
    triggers.append({"type": "http", "config": {"auth": auth, "path": path, "method": "POST"}})
if cron:
    triggers.append({"type": "cron", "config": {"schedule": cron, "timezone": "America/Los_Angeles"}})
env_vars = {
    "SITE_URL": "https://olivistart.com",
}
service_key_consumers = {
    "admin-manage", "enroll-guard", "guest-enroll", "manage-account",
    "manage-artwork", "trigger-schedule-bake",
}
# Butterbase functions are single-file and cannot import a shared module, so
# the admin allowlist is injected instead of being copied into each one.
# backend/admin-emails.json is the only place it is written down.
admin_allowlist_consumers = {"admin-manage", "manage-students", "manage-artwork"}
if name in admin_allowlist_consumers:
    allowlist_path = os.path.join(os.path.dirname(os.path.dirname(file)), "admin-emails.json")
    with open(allowlist_path) as allowlist_file:
        allowlist = json.load(allowlist_file)
    if not isinstance(allowlist, list) or not allowlist or not all(
        isinstance(entry, str) and "@" in entry for entry in allowlist
    ):
        raise SystemExit(f"error: {allowlist_path} must be a non-empty list of email addresses")
    env_vars["ADMIN_EMAILS"] = json.dumps(allowlist)
if name in service_key_consumers:
    env_vars["SERVICE_KEY"] = os.environ["BUTTERBASE_API_KEY"]
if name == "trigger-schedule-bake":
    env_vars["GITHUB_TOKEN"] = os.environ["GITHUB_TOKEN"]
if name == "admin-manage":
    env_vars["INVITATION_GMAIL_USER_ID"] = os.environ["INVITATION_GMAIL_USER_ID"]
payload = {
    "name": name,
    "description": desc,
    "code": open(file).read(),
    "triggers": triggers,
    "allow_service_key_impersonation": impersonation == "true",
    # Sensitive environment entries are added only to their actual consumers.
    # The platform encrypts them at rest and they are never written to the repo.
    "envVars": env_vars,
}
json.dump(payload, sys.stdout)
PY

  local out curl_config
  printf -v curl_config '%s\n' \
    'silent' \
    'show-error' \
    'max-time = 30' \
    'request = "POST"' \
    "header = \"Authorization: Bearer $BUTTERBASE_API_KEY\"" \
    'header = "Content-Type: application/json"' \
    "data = \"@$PAYLOAD_FILE\"" \
    "url = \"$API_BASE/v1/$APP_ID/functions\""
  out=$(curl --config - <<<"$curl_config")
  unset curl_config
  if grep -q '"deployedAt"' <<<"$out"; then
    echo "deployed: $name"
  else
    echo "FAILED: $name" >&2
    return 1
  fi
}

for cfg in "${CONFIGS[@]}"; do
  IFS='|' read -r name auth path impersonation desc <<<"$cfg"
  cron=""
  [[ "$name" == "sync-student-ages" ]] && cron="0 0 * * *"
  if [[ ${#selected[@]} -gt 0 ]]; then
    match=false
    for s in "${selected[@]}"; do [[ "$s" == "$name" ]] && match=true; done
    $match || continue
  fi
  deploy_one "$name" "$auth" "$path" "$impersonation" "$desc" "$cron"
done
