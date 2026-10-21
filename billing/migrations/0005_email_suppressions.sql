-- Addresses that asked not to be emailed, and the two views that honor them. Production recorded
-- this migration on 2026-10-14, but the file never reached the repository. Its statements are the
-- live schema read back from production's sqlite_master on 2026-10-20, so fresh and local
-- databases match production. The Worker doesn't read or write suppressions, and no signup row is
-- changed or deleted. Addresses are stored trimmed and lowercased.
CREATE TABLE email_suppressions (
  email TEXT PRIMARY KEY CHECK (email = lower(trim(email)) AND length(email) BETWEEN 6 AND 254),
  requested_at INTEGER NOT NULL CHECK (requested_at > 0),
  recorded_at INTEGER NOT NULL CHECK (recorded_at > 0),
  reason TEXT NOT NULL CHECK (reason = 'unsubscribe'),
  source_ref TEXT NOT NULL CHECK (length(source_ref) > 0)
);

-- Who may receive a DayBoard mailing: every reviewed or unreviewed signup that isn't a known test
-- address and hasn't unsubscribed, once per address.
CREATE VIEW dayboard_mailing_recipients AS
SELECT DISTINCT lower(trim(b.email)) AS email
FROM beta_signups AS b
WHERE b.classification <> 'likely_test'
  AND NOT EXISTS (
    SELECT 1 FROM email_suppressions AS s WHERE s.email = lower(trim(b.email))
  );

-- The waitlist as read in the Cloudflare dashboard, newest first, without unsubscribed addresses.
CREATE VIEW waitlist_signups AS
SELECT email,
  strftime('%Y-%m-%d %H:%M:%f', created_at / 1000.0, 'unixepoch') || ' UTC' AS signed_up_at_utc,
  cohort,
  classification AS review_status,
  ROUND((unixepoch('now') * 1000 - created_at) / 86400000.0, 2) AS days_since_signup,
  CASE WHEN created_at >= (unixepoch('now') - 259200) * 1000 THEN 1 ELSE 0 END AS signed_up_last_3_days,
  CASE WHEN created_at >= (unixepoch('now') - 604800) * 1000 THEN 1 ELSE 0 END AS signed_up_last_7_days,
  created_at AS created_at_unix_ms
FROM beta_signups AS b
WHERE NOT EXISTS (
  SELECT 1 FROM email_suppressions AS s WHERE s.email = lower(trim(b.email))
)
ORDER BY created_at DESC, email;
