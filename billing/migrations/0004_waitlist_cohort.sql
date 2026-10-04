-- Waitlist metadata for the existing signup table. Additive only: email and created_at are never
-- rewritten, and the earlier Worker still inserts (email, created_at), so it can run against this.
-- Neither column records an invitation, an access grant or verified mailbox ownership.
ALTER TABLE beta_signups ADD COLUMN cohort TEXT NOT NULL DEFAULT 'waitlist'
  CHECK (cohort IN ('waitlist', 'early_access'));
ALTER TABLE beta_signups ADD COLUMN classification TEXT NOT NULL DEFAULT 'unreviewed'
  CHECK (classification IN ('unreviewed', 'reviewed', 'likely_test'));
-- A reserved test address from a historical notification. It is absent from production, so this
-- only classifies it where a fixture or another database holds it. It is never inserted.
UPDATE beta_signups SET classification = 'likely_test'
  WHERE email = 'dayboard-verify+notify@example.com';
-- The reviewed first cohort: rows up to the newest reviewed signup, 2026-10-04 18:51:27.001 UTC.
-- Later arrivals keep the defaults, an unreviewed waitlist entry.
UPDATE beta_signups SET cohort = 'early_access', classification = 'reviewed'
  WHERE created_at <= 1791139887001 AND classification = 'unreviewed';
