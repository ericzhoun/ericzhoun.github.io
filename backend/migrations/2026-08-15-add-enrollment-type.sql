-- Migration: distinguish free trials from standard enrollments.
-- Safe, additive change. Existing rows default to 'standard'.
-- ENV-GATED: requires live Butterbase DB access. Not executed by the agent.

ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS enrollment_type text NOT NULL DEFAULT 'standard';

COMMENT ON COLUMN enrollments.enrollment_type IS 'standard | trial';

-- Supports the one-trial-per-email eligibility check in book-trial.
CREATE INDEX IF NOT EXISTS idx_enrollments_trial_email
  ON enrollments (enrollment_type, student_email);
