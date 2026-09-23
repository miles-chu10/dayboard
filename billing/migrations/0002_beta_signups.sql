CREATE TABLE beta_signups (
  email TEXT PRIMARY KEY CHECK (length(email) BETWEEN 6 AND 254),
  created_at INTEGER NOT NULL
);
