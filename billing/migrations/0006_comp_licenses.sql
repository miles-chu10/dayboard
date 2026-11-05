-- Complimentary ("comp") licenses: free DayBoard Pro keys the owner issues through the admin route,
-- for example to beta testers. Additive only: this creates one table and changes no existing row.
--
-- A comp key is an ordinary licenses row, minted, hashed and encrypted like a paid key, so the
-- validate, activate and deactivate routes and the activation cap treat it the same way. Because
-- licenses.order_id and licenses.payment_intent_id are NOT NULL foreign keys, the Worker gives each
-- comp license its own placeholder orders and payments rows whose IDs start with comp_. Stripe IDs
-- never start with comp_, and the order ID can't match the checkout routes' 32-character pattern,
-- so neither Stripe events nor browser claims can reach them. Revoking a comp license sets its
-- payments row's revoked flag, the tombstone a full refund sets, so a revoked comp key fails exactly
-- like a refunded paid key.
--
-- This table holds only the owner's short label, never an email address, and the issue and
-- revocation times. The key itself is stored only as the HMAC and AES-GCM ciphertext in licenses.
CREATE TABLE comp_licenses (
  license_id TEXT PRIMARY KEY REFERENCES licenses(id),
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 64 AND instr(label, '@') = 0),
  created_at INTEGER NOT NULL CHECK (created_at > 0),
  revoked_at INTEGER CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
