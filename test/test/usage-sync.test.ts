import { describe, expect, it } from "vitest";
import { billingProfileBody, thisYear, usageBatch, usageEventBody } from "../factories/index.ts";
import { TestApi } from "../support/api.ts";
import {
  UNKNOWN_ID,
  givenBillableCustomer,
  givenCustomer,
  givenIngestedEvents,
  givenSyncedUsage,
  givenUnlinkedCustomer,
  polarCalls,
  sqlCountSettlements,
  sqlUnmarkSynced,
} from "../support/fixtures.ts";

const sync = (api: TestApi, customerId: string, period = thisYear) =>
  api.client.customers[":customerId"].usage.sync.$post({ param: { customerId }, json: period });

describe("usage sync", () => {
  describe("GIVEN a billable customer with unsynced events", () => {
    it("WHEN syncing the period THEN the settlement reports the synced quantity and a paid charge of quantity × unit price", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const response = await sync(api, customer.id);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        customerId: customer.id,
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
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (await sync(api, customer.id)).json();

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
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { eventId: "e-1", quantity: 2, metadata: { path: "/x" } }),
      ]);

      await sync(api, customer.id);

      expect(api.polar.state.events).toEqual([
        expect.objectContaining({
          external_id: "e-1",
          external_customer_id: customer.id,
          name: "api_call",
          metadata: { path: "/x", quantity: 2 },
        }),
      ]);
    });

    it("WHEN syncing the period THEN the order charges the Polar customer the right amount and currency", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      await sync(api, customer.id);

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

    it("WHEN syncing THEN the order description mentions the units and metadata carries our customer id", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      await sync(api, customer.id);

      expect([...api.polar.state.orders.values()][0]).toMatchObject({
        description: expect.stringContaining("3 units"),
        metadata: { customerId: customer.id, syncedEvents: 1, syncedQuantity: 3 },
      });
    });

    it("WHEN syncing THEN a settlement row is recorded", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id)]);

      await sync(api, customer.id);

      expect(await sqlCountSettlements(api, customer.id)).toBe(1);
    });

    it("WHEN the charge rounds to a half cent THEN it is rounded to the nearest cent", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 1.5 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement.charge).toMatchObject({ amountCents: 11 });
    });

    it("WHEN the profile has included units THEN they are still charged (known limitation: allowances are the meter's job)", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(
        api,
        billingProfileBody({ pricing: { includedUnits: 5 } }),
      );
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement.charge).toMatchObject({ amountCents: 21 });
    });

    it("WHEN only part of the events fall in the period THEN only those are synced and a wider sync picks up the rest", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [
        usageEventBody(customer.id, { quantity: 1, occurredAt: "2026-02-10T00:00:00Z" }),
        usageEventBody(customer.id, { quantity: 2, occurredAt: "2026-03-10T00:00:00Z" }),
      ]);
      const february = await (
        await sync(api, customer.id, { start: "2026-02-01T00:00:00Z", end: "2026-03-01T00:00:00Z" })
      ).json();

      const rest = await (await sync(api, customer.id)).json();

      expect(february).toMatchObject({ syncedEvents: 1, syncedQuantity: 1 });
      expect(rest).toMatchObject({ syncedEvents: 1, syncedQuantity: 2 });
    });

    it("WHEN syncing one customer THEN another customer's events stay unsynced", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      const other = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [
        usageEventBody(customer.id),
        usageEventBody(other.id, { quantity: 9 }),
      ]);
      await sync(api, customer.id);

      const settlement = await (await sync(api, other.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 1, syncedQuantity: 9 });
    });

    it("WHEN syncing a period that does not contain the events THEN nothing is synced nor charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (
        await sync(api, customer.id, { start: "2025-01-01T00:00:00Z", end: "2025-02-01T00:00:00Z" })
      ).json();

      expect(settlement).toMatchObject({ syncedEvents: 0, syncedQuantity: 0, charge: null });
    });

    it("WHEN the period is invalid THEN 400", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);

      const response = await sync(api, customer.id, { start: thisYear.end, end: thisYear.start });

      expect(response.status).toBe(400);
    });
  });

  describe("GIVEN already synced events", () => {
    it("WHEN syncing again THEN nothing is synced and nothing is charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);
      await givenSyncedUsage(api, customer.id, thisYear);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 0, syncedQuantity: 0, charge: null });
    });

    it("WHEN new events arrive THEN only those are synced and charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);
      await givenSyncedUsage(api, customer.id, thisYear);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 2 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({
        syncedEvents: 1,
        syncedQuantity: 2,
        charge: { amountCents: 14 },
      });
    });
  });

  describe("GIVEN 600 unsynced events", () => {
    it("WHEN syncing THEN they are forwarded in two chunks and charged once", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(
        api,
        billingProfileBody({ limits: { monthlyEventLimit: 10_000 } }),
      );
      await givenIngestedEvents(api, usageBatch(customer.id, 600));

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 600, charge: { amountCents: 4200 } });
      expect(polarCalls(api).filter((c) => c === "POST /v1/events/ingest")).toHaveLength(2);
      expect(api.polar.state.orders.size).toBe(1);
    });
  });

  describe("GIVEN a pro plan with a zero unit price", () => {
    it("WHEN syncing THEN events are forwarded but nothing is charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(
        api,
        billingProfileBody({ pricing: { pricePerUnitCents: 0 } }),
      );
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 1, charge: null });
    });
  });

  describe("GIVEN a crash between the Polar ingest and marking the events synced", () => {
    it("WHEN syncing again THEN Polar dedups the events but the quantity is charged again (known limitation)", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);
      await givenSyncedUsage(api, customer.id, thisYear);
      await sqlUnmarkSynced(api, customer.id);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 1, charge: { amountCents: 21 } });
      expect(api.polar.state.events).toHaveLength(1);
      expect(api.polar.state.orders.size).toBe(2);
    });
  });

  describe("GIVEN a customer on the free plan", () => {
    it("WHEN syncing THEN events are forwarded but nothing is charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(
        api,
        billingProfileBody({ pricing: { plan: "free", pricePerUnitCents: 0 } }),
      );
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 1, charge: null });
      expect(polarCalls(api)).toEqual(["POST /v1/customers/", "POST /v1/events/ingest"]);
    });
  });

  describe("GIVEN a customer without a billing profile", () => {
    it("WHEN syncing THEN events are forwarded but nothing is charged", async () => {
      await using api = await TestApi.start();
      const customer = await givenCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 3 })]);

      const settlement = await (await sync(api, customer.id)).json();

      expect(settlement).toMatchObject({ syncedEvents: 1, syncedQuantity: 3, charge: null });
    });
  });

  describe("GIVEN a customer not linked to Polar", () => {
    it("WHEN syncing THEN 422", async () => {
      await using api = await TestApi.start();
      const customer = await givenUnlinkedCustomer(api);

      const response = await sync(api, customer.id);

      expect(response.status).toBe(422);
      expect(await response.json()).toMatchObject({
        message: expect.stringContaining("not linked"),
      });
    });
  });

  describe("GIVEN an unknown customer", () => {
    it("WHEN syncing THEN 404", async () => {
      await using api = await TestApi.start();

      const response = await sync(api, UNKNOWN_ID);

      expect(response.status).toBe(404);
    });
  });

  describe("GIVEN a billable customer with unsynced events this month", () => {
    it("WHEN deleting the customer THEN the month is settled and charged before deletion", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 4 })]);

      const response = await api.client.customers[":id"].$delete({ param: { id: customer.id } });

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        customerId: customer.id,
        settlement: {
          syncedEvents: 1,
          syncedQuantity: 4,
          charge: { amountCents: 28, currency: "EUR", status: "paid" },
        },
      });
    });

    it("WHEN deleting the customer THEN Polar is charged before the mirror is deleted", async () => {
      await using api = await TestApi.start();
      const customer = await givenBillableCustomer(api);
      await givenIngestedEvents(api, [usageEventBody(customer.id, { quantity: 4 })]);

      const { settlement } = await (
        await api.client.customers[":id"].$delete({ param: { id: customer.id } })
      ).json();

      expect(polarCalls(api)).toEqual([
        "POST /v1/customers/",
        "POST /v1/events/ingest",
        "POST /v1/orders/",
        `POST /v1/orders/${settlement?.charge?.orderId}/finalize`,
        `DELETE /v1/customers/${customer.polarCustomerId}`,
      ]);
    });
  });

  describe("GIVEN a customer not linked to Polar", () => {
    it("WHEN deleting it THEN no settlement is attempted", async () => {
      await using api = await TestApi.start();
      const customer = await givenUnlinkedCustomer(api);

      const response = await api.client.customers[":id"].$delete({ param: { id: customer.id } });

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ customerId: customer.id, settlement: null });
    });
  });
});
