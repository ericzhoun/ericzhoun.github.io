#!/usr/bin/env python3
"""Recreate a Butterbase app's end users on another app and emit an id map.

Butterbase exposes no create-with-id and no password-hash export (see
manage_auth_users: only `list` and `delete`). Accounts therefore have to be
remade through the public signup endpoint, which mints NEW user ids - so every
user_id reference in the copied data has to be remapped. This script produces
that map; migrate.py consumes it via USER_MAP.

Each account gets a random password nobody retains. Users sign in afterwards
with a magic-link code, the same way admin-manage's create-account flow works.

The roster is read from a JSON file rather than embedded here, because it
contains customer email addresses and this repository is public. Keep that file
out of git.

    roster.json:
    [
      {"old_id": "<uuid on the source app>",
       "email": "parent@example.com",
       "display_name": "Optional Name"}
    ]

Get the source roster from the platform (it is not exposed over the data API):
    manage_auth_users { app_id: <source>, action: "list" }

Usage:
    DST=app_y ROSTER=roster.json ./create_users.py [--out user_map.json]

Idempotent: an address the destination already knows is reported as existing
and skipped, so a partial run - signup is rate limited, see below - can simply
be re-run. Rebuild the map authoritatively afterwards from manage_auth_users
on the destination rather than trusting a partial run's output.

Rate limit: signup permits roughly 5 accounts per 15 minutes and then returns
429. This script backs off and retries rather than failing the batch.
"""
import argparse
import base64
import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.request

API = os.environ.get("API", "https://api.butterbase.ai")
DST = os.environ["DST"]
ROSTER = os.environ.get("ROSTER", "roster.json")

MAX_ATTEMPTS = 8
BACKOFF_SECONDS = 300


def random_password():
    """Matches guest-enroll's generator: upper, lower, digit, and special."""
    raw = base64.b64encode(secrets.token_bytes(24)).decode()
    return "Aa1!" + "".join(c for c in raw if c.isalnum())


def signup(email, display_name):
    req = urllib.request.Request(
        f"{API}/auth/{DST}/signup",
        data=json.dumps(
            {
                "email": email,
                "password": random_password(),
                "display_name": display_name or email,
            }
        ).encode(),
        method="POST",
    )
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return res.status, json.loads(res.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def main(out_path):
    with open(ROSTER) as fh:
        roster = json.load(fh)

    mapping = {}
    pending = list(roster)
    for attempt in range(1, MAX_ATTEMPTS + 1):
        deferred = []
        for entry in pending:
            email = entry["email"]
            status, body = signup(email, entry.get("display_name"))
            message = str(body.get("error") or body.get("message") or "")
            if status in (200, 201) and body.get("user", {}).get("id"):
                mapping[entry["old_id"]] = body["user"]["id"]
                print(f"created  {email}", flush=True)
            elif "already exists" in message or "already registered" in message:
                # Present but unmapped - the caller rebuilds the map from the
                # platform listing, which is authoritative.
                print(f"exists   {email}", flush=True)
            elif status == 429:
                deferred.append(entry)
                print(f"limited  {email} (attempt {attempt})", flush=True)
            else:
                deferred.append(entry)
                print(f"error    {email} ({status}): {message}", flush=True)

        pending = deferred
        if not pending:
            break
        if attempt < MAX_ATTEMPTS:
            print(f"sleeping {BACKOFF_SECONDS}s before retry", flush=True)
            time.sleep(BACKOFF_SECONDS)

    with open(out_path, "w") as fh:
        json.dump(mapping, fh, indent=2)
    print(f"\n{len(mapping)} newly mapped -> {out_path}", flush=True)
    if pending:
        print(f"still pending: {[e['email'] for e in pending]}", flush=True)
    return 1 if pending else 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="user_map.json")
    sys.exit(main(parser.parse_args().out))
