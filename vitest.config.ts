import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

// Test env without dotenv: Node's built-in loader populates process.env for this process
// (config + globalSetup) and `test.env` forwards the relevant keys to worker threads.
const ENV_FILE = ".env.test";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const pick = (...keys: string[]) =>
  Object.fromEntries(
    keys.flatMap((key) => (process.env[key] === undefined ? [] : [[key, process.env[key]]])),
  );

export default defineConfig({
  test: {
    include: ["test/test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    env: pick("API_TOKEN", "POLAR_ENVIRONMENT", "POLAR_ACCESS_TOKEN", "POLAR_PRODUCT_ID", "TEST_PG_POOL_MAX"),
    fileParallelism: true,
    pool: "threads",
    // msw's cookie store probes `localStorage`; Node ≥ 25 warns about it being experimental
    execArgv: ["--disable-warning=ExperimentalWarning"],
    hookTimeout: 180_000,
    testTimeout: 30_000,
    isolate: false,
    // Postgres (Docker VM) and the workers share the same cores: more workers than half the CPUs
    // only adds contention (measured: 10 workers ≈ 8.5–10 s, 4–5 workers ≈ 7.5 s on a 10-core box).
    maxWorkers: Number(process.env.VITEST_MAX_WORKERS) || Math.max(2, Math.floor(availableParallelism() / 2)),
  },
});
