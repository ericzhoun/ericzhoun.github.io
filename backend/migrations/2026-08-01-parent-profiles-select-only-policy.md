# Parent profile select-only policy migration

Status: specified, not applied

This runbook changes `parent_profiles` from parent-readable and parent-writable
to parent-readable only. Profile writes then occur only through the verified
`manage-account` function using its encrypted service credential.

The sequence is idempotent because it replaces the table's complete RLS policy
set with the same desired state on every run. It must be performed as one
maintenance operation by an app owner. Do not run individual steps while the
app is serving traffic.

## Preconditions

1. Deploy the remediated `manage-account` function first and verify that its
   `SERVICE_KEY` environment entry is configured.
2. Confirm the current `parent_profiles` table and column definitions from
   `GET /v1/{app_id}/schema`.
3. Capture `GET /v1/{app_id}/rls` as rollback evidence outside the repository.
4. Obtain explicit production approval and announce a maintenance window.

## Apply

1. Pause the app through the owner-only app pause control. Keep it paused until
   all verification below succeeds.
2. Remove the current policy set with
   `DELETE /v1/{app_id}/rls/parent_profiles`.
3. Re-enable RLS with `POST /v1/{app_id}/rls/enable` and this body:

   ```json
   { "table_name": "parent_profiles" }
   ```

   Enabling RLS creates the standard `butterbase_service` bypass policy.
4. Create the only end-user policy with
   `POST /v1/{app_id}/rls/policies` and this body:

   ```json
   {
     "table_name": "parent_profiles",
     "policy_name": "parent_profiles_own_select",
     "command": "SELECT",
     "role": "user",
     "using_expression": "user_id = current_user_id()::uuid"
   }
   ```

## Verify before resuming

1. Inspect `GET /v1/{app_id}/rls`. Require exactly one
   `butterbase_user` policy on `parent_profiles`, with command `SELECT` and the
   own-row expression above. Require the `butterbase_service` bypass policy.
   Stop if any end-user `INSERT`, `UPDATE`, `DELETE`, or `ALL` policy exists.
2. Using disposable users through an approved test harness:
   - Own-row `SELECT` succeeds.
   - Cross-user `SELECT` returns no row.
   - Direct end-user `POST`, `PATCH`, and `DELETE` are denied.
   - `manage-account` saves the verified user's profile and returns the saved
     row.
3. Resume the app only after every assertion passes.

## Rollback

Keep the app paused. Remove the replacement policy set, re-enable RLS, and
recreate the exact policies captured in the precondition snapshot. Verify the
restored policy list before resuming. Never disable RLS as a rollback state.
