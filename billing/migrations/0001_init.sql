CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  capability_hash TEXT NOT NULL UNIQUE,
  capability_expires_at INTEGER NOT NULL,
  session_id TEXT UNIQUE,
  payment_intent_id TEXT UNIQUE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','ready','failed','revoked')),
  created_at INTEGER NOT NULL
);
CREATE TABLE payments (
  payment_intent_id TEXT PRIMARY KEY,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
  reason TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE licenses (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL UNIQUE REFERENCES orders(id),
  payment_intent_id TEXT NOT NULL UNIQUE REFERENCES payments(payment_intent_id),
  issuer TEXT NOT NULL,
  product_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment IN ('test','live')),
  key_hash TEXT NOT NULL UNIQUE,
  key_ciphertext TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE activations (
  instance_id TEXT PRIMARY KEY,
  license_id TEXT NOT NULL REFERENCES licenses(id),
  installation_id TEXT NOT NULL,
  instance_name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (license_id, installation_id)
);
CREATE INDEX activations_license_idx ON activations(license_id);
CREATE TABLE webhook_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE TABLE rate_limits (
  bucket TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  hits INTEGER NOT NULL
);
