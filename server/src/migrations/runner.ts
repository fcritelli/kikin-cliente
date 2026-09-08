import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";

const dir = dirname(fileURLToPath(import.meta.url));
const NAME_RE = /^(\d+_.+)\.sql$/;

async function applied(): Promise<Set<string>> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  const res = await pool.query<{ filename: string }>("SELECT filename FROM client_schema_migrations");
  return new Set(res.rows.map((r) => r.filename));
}

async function migrate(): Promise<void> {
  await pool.query("SELECT pg_advisory_lock(202609090001)");
  try {
    const done = await applied();
    const files = (await readdir(dir))
      .filter((f) => NAME_RE.test(f))
      .sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(join(dir, file), "utf8");
      await pool.query("BEGIN");
      try {
        await pool.query(sql);
        await pool.query("INSERT INTO client_schema_migrations (filename) VALUES ($1)", [file]);
        await pool.query("COMMIT");
        console.log(`Applied ${file}`);
      } catch (err) {
        await pool.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await pool.query("SELECT pg_advisory_unlock(202609090001)").catch(() => undefined);
  }
}

const cmd = process.argv[2];
if (cmd === "migrate") {
  await migrate();
} else if (cmd === "status") {
  const done = await applied();
  const files = (await readdir(dir)).filter((f) => NAME_RE.test(f)).sort();
  for (const file of files) {
    console.log(`${done.has(file) ? "applied " : "pending "} ${file}`);
  }
} else {
  throw new Error("Usage: runner.ts <migrate|status>");
}
await pool.end();
