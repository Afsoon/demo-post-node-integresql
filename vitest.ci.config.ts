import { defineConfig } from "vitest/config";
import baseConfig from "./vitest.config.ts";

const databaseUrl = process.env.PGTEST_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("PGTEST_DATABASE_URL is required for the CI profile; start and prepare the test containers first.");
}
const { protocol } = new URL(databaseUrl);
if (protocol !== "postgres:" && protocol !== "postgresql:") {
  throw new Error("PGTEST_DATABASE_URL must use postgres:// or postgresql://");
}

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    // Replace the setup array: merging configs would retain the Testcontainers setup.
    globalSetup: [],
    env: { ...baseConfig.test?.env, PGTEST_DATABASE_URL: databaseUrl },
  },
});
