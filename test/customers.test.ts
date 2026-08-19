import { describe, expect, it } from "vitest";
import { TestApi } from "./support/api.ts";
import { defaultCustomer, givenCustomer, polarCalls } from "./support/fixtures.ts";

const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

describe("customers", () => {
  describe("GIVEN no customers", () => {
    it("WHEN creating one with a mixed-case email THEN it is stored normalized and active", async () => {
      await using api = await TestApi.start();

      const response = await api.client.customers.$post({
        json: { ...defaultCustomer, email: "Ada@Example.com" },
      });

      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({
        email: "ada@example.com",
        name: "Ada Lovelace",
        status: "active",
      });
    });

    it("WHEN creating one THEN it is linked to a Polar customer id", async () => {
      await using api = await TestApi.start();

      const customer = await (await api.client.customers.$post({ json: defaultCustomer })).json();

      expect(customer.polarCustomerId).toMatch(/^cus_/);
    });

    it("WHEN creating one THEN Polar receives a mirror keyed by our id as external_id", async () => {
      await using api = await TestApi.start();

      const customer = await (await api.client.customers.$post({ json: defaultCustomer })).json();

      expect([...api.polar.state.customers.values()]).toEqual([
        expect.objectContaining({
          external_id: customer.id,
          email: "ada@example.com",
          type: "individual",
        }),
      ]);
    });

    it("WHEN listing THEN the page is empty", async () => {
      await using api = await TestApi.start();

      const response = await api.client.customers.$get({ query: {} });

      expect(await response.json()).toEqual({ items: [], nextCursor: null });
    });

    it("WHEN requesting an unknown id THEN 404", async () => {
      await using api = await TestApi.start();

      const response = await api.client.customers[":id"].$get({ param: { id: UNKNOWN_ID } });

      expect(response.status).toBe(404);
    });

    it("WHEN calling without a token THEN 401 with a Bearer challenge", async () => {
      await using api = await TestApi.start();

      const response = await api.anonymous.customers.$get({ query: {} });

      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toContain("Bearer");
    });
  });

  describe("GIVEN an existing customer", () => {
    it("WHEN reading it by id THEN the stored representation is returned", async () => {
      await using api = await TestApi.start();
      const customer = await givenCustomer(api);

      const response = await api.client.customers[":id"].$get({ param: { id: customer.id } });

      expect(await response.json()).toEqual(customer);
    });

    it("WHEN creating another with the same email in a different case THEN 409 conflict", async () => {
      await using api = await TestApi.start();
      await givenCustomer(api, { email: "ada@example.com" });

      const response = await api.client.customers.$post({
        json: { ...defaultCustomer, email: "ADA@example.com" },
      });

      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: "conflict" });
    });

    it("WHEN deleting it THEN 200 with an empty settlement", async () => {
      await using api = await TestApi.start();
      const customer = await givenCustomer(api);

      const response = await api.client.customers[":id"].$delete({ param: { id: customer.id } });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        customerId: customer.id,
        settlement: { syncedEvents: 0, charge: null },
      });
    });

    it("WHEN deleting it THEN its Polar mirror is deleted", async () => {
      await using api = await TestApi.start();
      const customer = await givenCustomer(api);

      await api.client.customers[":id"].$delete({ param: { id: customer.id } });

      expect(api.polar.state.customers.size).toBe(0);
      expect(polarCalls(api).at(-1)).toBe(`DELETE /v1/customers/${customer.polarCustomerId}`);
    });
  });
});
