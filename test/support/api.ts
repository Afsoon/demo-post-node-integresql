import { testClient } from "hono/testing";
import { type App, createApp } from "../../src/app.ts";
import { loadEnv } from "../../src/config/env.ts";
import {
  type Container,
  createBillingProviderFromEnv,
  createContainer,
} from "../../src/container.ts";
import type { Db } from "../../src/infra/db/client.ts";
import { createTestDatabase, type TestDatabase } from "./database.ts";
import { createPolarMock, type PolarMock } from "./polar-mock.ts";

export class TestApi implements AsyncDisposable {
  readonly app: App;
  readonly db: Db;
  readonly container: Container;
  readonly apiToken: string;
  readonly polar: PolarMock;
  readonly client: ReturnType<typeof testClient<App>>;
  readonly anonymous: ReturnType<typeof testClient<App>>;
  readonly #database: TestDatabase;
  #released = false;

  private constructor(
    database: TestDatabase,
    polar: PolarMock,
    container: Container,
    app: App,
    apiToken: string,
  ) {
    this.#database = database;
    this.polar = polar;
    this.db = database.db;
    this.container = container;
    this.app = app;
    this.apiToken = apiToken;
    this.client = testClient(app, {}, undefined, {
      headers: { Authorization: `Bearer ${apiToken}` },
    });
    this.anonymous = testClient(app);
  }

  static async start() {
    const polar = createPolarMock();
    polar.listen();

    let database: TestDatabase | undefined;
    try {
      database = await createTestDatabase();

      const env = loadEnv({ ...process.env, DATABASE_URL: database.url });
      const container = createContainer({
        db: database.db,
        billingProvider: createBillingProviderFromEnv(env),
      });
      const app = createApp(container, { apiToken: env.API_TOKEN, logger: false });
      return new TestApi(database, polar, container, app, env.API_TOKEN);
    } catch (error) {
      polar.close();
      await database?.release();
      throw error;
    }
  }

  request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${this.apiToken}`);
    return this.app.request(path, { ...init, headers });
  }

  async [Symbol.asyncDispose]() {
    if (this.#released) return;
    this.#released = true;
    try {
      this.polar.close();
    } finally {
      await this.#database.release();
    }
  }
}
