import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";
import { TestApi } from "./support/api.ts";
import { defaultCustomer } from "./support/fixtures.ts";

const polarCustomersDown = (api: TestApi) =>
  api.polar.use(
    http.post(`${api.polar.baseUrl}/v1/customers/`, () =>
      HttpResponse.json({ detail: "upstream exploded" }, { status: 500 }),
    ),
  );

describe("Polar failures", () => {
  describe("GIVEN Polar answering 500 on customer creation", () => {
    it("WHEN creating a customer THEN 502 billing_provider_error", async () => {
      await using api = await TestApi.start();
      polarCustomersDown(api);

      const response = await api.client.customers.$post({ json: defaultCustomer });

      expect(response.status).toBe(502);
      expect(await response.json()).toMatchObject({ code: "billing_provider_error" });
    });

    it("WHEN creating a customer THEN the local row is kept without a Polar link (retryable)", async () => {
      await using api = await TestApi.start();
      polarCustomersDown(api);
      await api.client.customers.$post({ json: defaultCustomer });

      const list = await (await api.client.customers.$get({ query: {} })).json();

      expect(list.items).toEqual([
        expect.objectContaining({ email: "ada@example.com", polarCustomerId: null }),
      ]);
    });
  });

  describe("GIVEN a previous api instance forced Polar to fail", () => {
    it("WHEN a new api instance creates a customer THEN it succeeds (overrides do not leak)", async () => {
      {
        await using previous = await TestApi.start();
        polarCustomersDown(previous);
      }
      await using api = await TestApi.start();

      const response = await api.client.customers.$post({ json: defaultCustomer });

      expect(response.status).toBe(201);
    });
  });

  describe("GIVEN a live api instance", () => {
    it("WHEN fetching a non-Polar URL THEN the request is rejected", async () => {
      await using api = await TestApi.start();

      const attempt = fetch("https://example.com/not-polar");

      await expect(attempt).rejects.toThrow();
      expect(api.polar.requests).toEqual([]);
    });

    it("WHEN starting another api instance THEN local integresql traffic still passes through", async () => {
      await using api = await TestApi.start();

      await using other = await TestApi.start();

      expect((await other.client.health.$get()).status).toBe(200);
      expect(other).not.toBe(api);
    });
  });
});
