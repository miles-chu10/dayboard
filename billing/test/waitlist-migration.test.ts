import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

const dir = new URL("../migrations/", import.meta.url);
const migrations = readdirSync(dir)
  .filter((file) => file.endsWith(".sql"))
  .sort();
const COHORTS = "0004_waitlist_cohort.sql";
const CUTOFF = 1791139887001;
const HISTORICAL_TEST = "dayboard-verify+notify@example.com";
const INSERT =
  "INSERT INTO beta_signups (email, created_at) VALUES (?, ?) ON CONFLICT(email) DO NOTHING";
// Synthetic stand-ins for the six reviewed signups, from the earliest reviewed time to the cutoff.
const REVIEWED: [string, number][] = [
  ["first@example.test", 1790225517612],
  ["second+tag@example.test", 1790400000000],
  ["third@example.test", 1790600000000],
  ["fourth@example.test", 1790800000000],
  ["fifth@example.test", 1791000000000],
  ["sixth@example.test", CUTOFF],
];

// A database at the schema before migration 0004, holding rows the earlier Worker wrote.
function beforeCohorts(rows: [string, number][]) {
  const db = new DatabaseSync(":memory:");
  for (const file of migrations.filter((name) => name < COHORTS))
    db.exec(readFileSync(new URL(file, dir), "utf8"));
  const insert = db.prepare(INSERT);
  for (const [email, createdAt] of rows) insert.run(email, createdAt);
  return db;
}
const migrate = (db: DatabaseSync) => db.exec(readFileSync(new URL(COHORTS, dir), "utf8"));
const originals = (db: DatabaseSync) =>
  db
    .prepare("SELECT rowid, email, created_at FROM beta_signups ORDER BY rowid")
    .all()
    .map((row) => [row.rowid, row.email, row.created_at]);
const labels = (db: DatabaseSync) =>
  db
    .prepare("SELECT email, cohort, classification FROM beta_signups ORDER BY rowid")
    .all()
    .map((row) => `${row.email} ${row.cohort} ${row.classification}`);
const count = (db: DatabaseSync, email: string) =>
  Number(db.prepare("SELECT COUNT(*) AS n FROM beta_signups WHERE email = ?").get(email)?.n);

test("migration 0004 labels the reviewed rows by the cutoff and rewrites no original data", () => {
  const db = beforeCohorts([...REVIEWED, ["after-review@example.test", CUTOFF + 1]]);
  const before = originals(db);
  migrate(db);
  assert.deepEqual(originals(db), before);
  assert.deepEqual(labels(db), [
    ...REVIEWED.map(([email]) => `${email} early_access reviewed`),
    "after-review@example.test waitlist unreviewed",
  ]);
  // The historical test address was never a signup, and the migration doesn't add it.
  assert.equal(count(db, HISTORICAL_TEST), 0);
  // The earlier Worker's two-column insert still works and gets the waitlist defaults.
  const insert = db.prepare(INSERT);
  assert.equal(Number(insert.run("next@example.test", CUTOFF + 2).changes), 1);
  assert.equal(Number(insert.run("first@example.test", CUTOFF + 3).changes), 0);
  assert.deepEqual(originals(db).slice(0, before.length), before);
  assert.equal(labels(db).at(-1), "next@example.test waitlist unreviewed");
  assert.throws(() => db.exec("UPDATE beta_signups SET cohort = 'vip'"), /CHECK constraint/);
  assert.throws(() => db.exec("UPDATE beta_signups SET classification = 'owner'"), /CHECK/);
  db.close();
});

test("a fixture holding the historical test address keeps it out of the reviewed cohort", () => {
  const db = beforeCohorts([...REVIEWED, [HISTORICAL_TEST, 1790500000000]]);
  migrate(db);
  assert.deepEqual(labels(db), [
    ...REVIEWED.map(([email]) => `${email} early_access reviewed`),
    `${HISTORICAL_TEST} waitlist likely_test`,
  ]);
  assert.equal(count(db, HISTORICAL_TEST), 1);
  db.close();
});
