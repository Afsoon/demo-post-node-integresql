import { describe, expect, it } from "vitest";
import { TestApi } from "./support/api.ts";
import {
  event,
  givenBillableCustomer,
  givenIngestedEvents,
  givenSyncedUsage,
  polarCalls,
  thisYear,
} from "./support/fixtures.ts";

const UNKNOWN_ID = "00000000-0000-7000-8000-000000000000";

describe("usage events", () => {
  describe("GIVEN a billable customer", () => {
    it("WHEN ingesting a batch with an in-batch duplicate and an unknown customer THEN the outcome reports inserted, duplicates and rejected", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      const batch = [
        event(customer.id, { eventId: "e-1", quantity: 2 }),
        event(customer.id, { eventId: "e-1", quantity: 99 }),
        event(customer.id, { eventId: "e-2", eventName: "tokens", quantity: 10.5 }),
        event(UNKNOWN_ID, { eventId: "e-3" }),
      ];

      const response = await api.client.webhooks["usage-events"].$post(
        { json: batch },
        { headers: { "x-idempotency-id": "batch-1" } },
      );

      expect(await response.json()).toEqual({
        received: 4,
        inserted: 2,
        duplicates: 1,
        rejected: [
          { index: 3, eventId: "e-3", reason: "unknown_customer", message: expect.any(String) },
        ],
      });
    });

    it("WHEN replaying a batch with the same idempotency key THEN the stored response is replayed", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      const batch = [event(customer.id)];
      const first = await givenIngestedEvents(api, batch, "batch-1");

      const replay = await api.client.webhooks["usage-events"].$post(
        { json: batch },
        { headers: { "x-idempotency-id": "batch-1" } },
      );

      expect(replay.headers.get("idempotent-replayed")).toBe("true");
      expect(await replay.json()).toEqual(first);
    });

    it("WHEN ingesting without an idempotency key THEN 400", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);

      const response = await api.client.webhooks["usage-events"].$post({
        json: [event(customer.id)],
      });

      expect(response.status).toBe(400);
    });

    it("WHEN reusing an idempotency key with a different body THEN 422 idempotency_mismatch", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id)], "key");

      const response = await api.client.webhooks["usage-events"].$post(
        { json: [event(customer.id)] },
        { headers: { "x-idempotency-id": "key" } },
      );

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({ code: "idempotency_mismatch" });
    });
  });

  describe("GIVEN events ingested this month", () => {
    it("WHEN reading current usage THEN totals and limit status are aggregated from the hypertable", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [
        event(customer.id, { quantity: 2 }),
        event(customer.id, { eventName: "tokens", quantity: 10.5 }),
      ]);

      const response = await api.client.customers[":customerId"].usage.current.$get({
        param: { customerId: customer.id },
      });

      expect(await response.json()).toMatchObject({
        totalQuantity: 12.5,
        eventCount: 2,
        limit: { monthlyEventLimit: 10, remaining: 8, exceeded: false },
      });
    });
  });

  describe("GIVEN unsynced events", () => {
    it("WHEN syncing the period THEN the settlement reports the synced quantity and a paid charge of quantity × unit price", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id, { quantity: 3 })]);

      const response = await api.client.customers[":customerId"].usage.sync.$post({
        param: { customerId: customer.id },
        json: thisYear,
      });

      expect(await response.json()).toMatchObject({
        syncedEvents: 1,
        syncedQuantity: 3,
        charge: {
          amountCents: 21,
          currency: "EUR",
          status: "paid",
          orderId: expect.stringMatching(/^ord_/),
        },
      });
    });

    it("WHEN syncing the period THEN Polar receives ingest, order and finalize in that order", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id, { eventId: "e-1", quantity: 3 })]);

      const settlement = await (
        await api.client.customers[":customerId"].usage.sync.$post({
          param: { customerId: customer.id },
          json: thisYear,
        })
      ).json();

      expect(polarCalls(api)).toEqual([
        "POST /v1/customers/",
        "POST /v1/events/ingest",
        "POST /v1/orders/",
        `POST /v1/orders/${settlement.charge?.orderId}/finalize`,
      ]);
    });

    it("WHEN syncing the period THEN the meter event is keyed by our eventId and customer id", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id, { eventId: "e-1" })]);

      await api.client.customers[":customerId"].usage.sync.$post({
        param: { customerId: customer.id },
        json: thisYear,
      });

      expect(api.polar.state.events).toEqual([
        expect.objectContaining({
          external_id: "e-1",
          external_customer_id: customer.id,
          name: "api_call",
        }),
      ]);
    });

    it("WHEN syncing the period THEN the order charges the Polar customer the right amount and currency", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id, { quantity: 3 })]);

      await api.client.customers[":customerId"].usage.sync.$post({
        param: { customerId: customer.id },
        json: thisYear,
      });

      expect([...api.polar.state.orders.values()]).toEqual([
        expect.objectContaining({
          customer_id: customer.polarCustomerId,
          product_id: "prod_usage_test",
          total_amount: 21,
          currency: "eur",
          status: "paid",
        }),
      ]);
    });
  });

  describe("GIVEN already synced events", () => {
    it("WHEN syncing again THEN nothing is synced and nothing is charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [event(customer.id, { quantity: 3 })]);
      await givenSyncedUsage(api, customer.id, thisYear);

      const response = await api.client.customers[":customerId"].usage.sync.$post({
        param: { customerId: customer.id },
        json: thisYear,
      });

      expect(await response.json()).toMatchObject({
        syncedEvents: 0,
        syncedQuantity: 0,
        charge: null,
      });
    });
  });
});
