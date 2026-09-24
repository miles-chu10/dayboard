import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export class LocalDb {
  readonly sql = new DatabaseSync(":memory:");
  failAtBatchStatement = 0;
  constructor() {
    this.sql.exec("PRAGMA foreign_keys=ON");
    const dir = fileURLToPath(new URL("../migrations/", import.meta.url));
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort())
      this.sql.exec(readFileSync(`${dir}${file}`, "utf8"));
  }
  prepare(query: string) {
    const sql = this.sql;
    return {
      bind(...params: unknown[]) {
        return {
          async first<T>() {
            return (sql.prepare(query).get(...(params as [])) ?? null) as T | null;
          },
          async run() {
            const result = sql.prepare(query).run(...(params as []));
            return { meta: { changes: Number(result.changes) } };
          },
        };
      },
    };
  }
  async batch(statements: Array<{ run(): Promise<unknown> }>) {
    this.sql.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      let number = 0;
      for (const statement of statements) {
        number++;
        if (this.failAtBatchStatement === number) throw new Error("simulated SQL failure");
        results.push(await statement.run());
      }
      this.sql.exec("COMMIT");
      return results;
    } catch (cause) {
      this.sql.exec("ROLLBACK");
      throw cause;
    }
  }
  close() {
    this.sql.close();
  }
}
