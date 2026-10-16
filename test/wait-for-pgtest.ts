import { setTimeout } from "node:timers/promises";
import { Client } from "pg";

const url = process.env.PGTEST_DATABASE_URL;
if (!url) throw new Error("PGTEST_DATABASE_URL is required");
const connection = new URL(url);
connection.pathname = "/pgtest";
const deadline = Date.now() + 60_000;

while (true) {
  const client = new Client({ connectionString: connection.toString(), connectionTimeoutMillis: 2_000 });
  try {
    // A PostgreSQL handshake against the virtual control DB verifies the proxy is ready.
    await client.connect();
    break;
  } catch (error) {
    if (Date.now() >= deadline) throw new Error("pgtest did not become ready within 60 seconds", { cause: error });
  } finally {
    await client.end();
  }
  await setTimeout(500);
}
