#!/usr/bin/env python3
"""Copy rows from one Butterbase app to another, preserving primary keys.

Idempotent: rows whose id already exists in the destination are skipped, so a
partial run can simply be re-run. Table order matters - parents before children,
because foreign keys are enforced.

Usage:
    SRC=app_x DST=app_y SRC_KEY=bb_sk_... DST_KEY=bb_sk_... ./migrate.py table [table ...]

user_id remapping: pass a JSON file via USER_MAP={"old-uuid": "new-uuid", ...}.
Rows carrying a user_id not present in the map are refused rather than silently
inserted with a dangling reference.
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = os.environ.get("API", "https://api.butterbase.ai")
SRC, DST = os.environ["SRC"], os.environ["DST"]
SRC_KEY, DST_KEY = os.environ["SRC_KEY"], os.environ["DST_KEY"]

# Primary key column per table; everything here uses "id" except parent_profiles.
PK = {"parent_profiles": "user_id"}

# Foreign keys that must already resolve in the destination. A child row whose
# parent was deliberately excluded (test data) is skipped rather than failed -
# otherwise the insert would 409 on the FK and look like a real error.
FKS = {
    "enrollments": [("schedule_id", "class_schedules"), ("student_id", "students")],
    "bookings": [("enrollment_id", "enrollments"), ("session_id", "class_sessions")],
    "artwork_photos": [("student_id", "students")],
}


def call(url, key, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {key}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return res.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def load_user_map():
    path = os.environ.get("USER_MAP")
    if not path:
        return None
    with open(path) as fh:
        return json.load(fh)


def dst_ids(table):
    """Primary keys already present in the destination, for FK resolution."""
    pk = PK.get(table, "id")
    _, rows = call(f"{API}/v1/{DST}/{table}?select={pk}", DST_KEY)
    return {r[pk] for r in (rows or [])}


def migrate(table, user_map, skip_users, remap):
    pk = PK.get(table, "id")
    status, rows = call(f"{API}/v1/{SRC}/{table}", SRC_KEY)
    if status != 200:
        print(f"  ! read failed ({status}): {rows}")
        return 1
    existing = dst_ids(table)
    parents = {parent: dst_ids(parent) for _, parent in FKS.get(table, [])}

    copied = present = excluded = 0
    failures = 0
    for row in rows:
        # parent_profiles is keyed by user_id, the very column being remapped,
        # so the presence check has to compare the mapped value - otherwise a
        # re-run compares a source id against destination ids, never matches,
        # and re-inserts into a duplicate primary key.
        probe = row[pk]
        if pk == "user_id" and user_map:
            probe = user_map.get(probe, probe)
        if probe in existing:
            present += 1
            continue

        owner = row.get("user_id")
        if owner and owner in skip_users:
            excluded += 1
            continue
        if owner:
            if user_map is None or owner not in user_map:
                print(f"  ! {table} {row[pk]}: user_id {owner} not in map - refusing")
                failures += 1
                continue
            row["user_id"] = user_map[owner]

        # Drop children of deliberately excluded parents.
        orphan = False
        for col, parent in FKS.get(table, []):
            ref = row.get(col)
            if ref and ref not in parents[parent]:
                excluded += 1
                orphan = True
                break
        if orphan:
            continue

        for col, new_value in remap.get(table, {}).items():
            if row.get(col) in new_value:
                row[col] = new_value[row[col]]

        status, body = call(f"{API}/v1/{DST}/{table}", DST_KEY, "POST", row)
        if status in (200, 201):
            copied += 1
        else:
            print(f"  ! {table} {row[pk]} failed ({status}): {body}")
            failures += 1
    print(
        f"  {table}: {copied} copied, {present} already present, "
        f"{excluded} excluded, {failures} failed"
    )
    return failures


if __name__ == "__main__":
    umap = load_user_map()
    skip = {u for u in os.environ.get("SKIP_USERS", "").split(",") if u}
    # Storage objects get new ids on re-upload, so the reference is rewritten.
    remap = json.loads(os.environ.get("REMAP", "{}"))
    total = sum(migrate(t, umap, skip, remap) for t in sys.argv[1:])
    if total:
        print(f"\n{total} row(s) failed")
    sys.exit(1 if total else 0)
