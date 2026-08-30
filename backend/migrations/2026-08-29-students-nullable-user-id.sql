-- Migration: allow admin-managed students whose parent account does not exist
-- yet ("standalone" students), so the admin can record attendance, class
-- credits, and 请假 (leave) for them before the family ever signs up.
--
-- Safe, additive change. Existing rows keep their user_id; nothing is
-- backfilled or rewritten. The admin writes standalone rows through
-- admin-manage with the service key, which the students_service_bypass
-- policy already admits.
--
-- RLS impact: end-user policies compare user_id with current_user_id(), and
-- `user_id = <uuid>` never matches NULL, so standalone rows stay invisible to
-- every parent until a user_id is attached. manage-students (parent self
-- service) and the artwork ownership EXISTS policy behave identically for
-- parented rows and keep hiding NULL-owner rows.
--
-- ENV-GATED: requires live Butterbase DB access (schema/apply with the full
-- schema from GET /schema, or psql-equivalent access). Not executed by the
-- agent. Apply BEFORE deploying the admin-manage changes that rely on it.

ALTER TABLE students ALTER COLUMN user_id DROP NOT NULL;

COMMENT ON COLUMN students.user_id IS
  'Owning parent; NULL while the student is admin-recorded standalone (no parent account yet).';

-- Rollback (only after re-attaching or removing standalone rows):
--   UPDATE students SET user_id = <parent> WHERE user_id IS NULL;  -- or delete them
--   ALTER TABLE students ALTER COLUMN user_id SET NOT NULL;
