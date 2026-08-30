-- Migration: placeholder families ("pending parents") the admin can record and
-- edit before the family owns an account. A standalone student links to one
-- through students.pending_parent_id instead of a user_id.
--
-- Column names mirror parent_profiles so promotion is a straight field copy.
-- email is nullable because the admin often has only a name at first; it stays
-- UNIQUE, and Postgres permits many NULLs under a unique constraint.
--
-- RLS: enabled with NO end-user policies, plus a service-key bypass. These rows
-- are admin-only and must never be readable from a parent session.
--
-- ENV-GATED: applied declaratively via POST /schema/apply with the full schema
-- from GET /schema. This file records intent; it is not executed directly.

CREATE TABLE pending_parents (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_name       text NOT NULL,
  email             text UNIQUE,
  student_phone     text,
  emergency_contact text,
  allergies         text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE students
  ADD COLUMN pending_parent_id uuid
  REFERENCES pending_parents(id) ON DELETE SET NULL;

COMMENT ON COLUMN students.pending_parent_id IS
  'Placeholder family owning this student while user_id is NULL; cleared when the family is promoted or claims the account.';

-- Rollback:
--   ALTER TABLE students DROP COLUMN pending_parent_id;
--   DROP TABLE pending_parents;
