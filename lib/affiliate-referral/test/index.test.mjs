import assert from "node:assert/strict";
import test from "node:test";
import {
  AffiliateReferralEngine,
  InMemoryAffiliateStore,
  InvalidTransitionError,
  SequentialIdGenerator,
} from "../dist/index.js";

function fixture(model = "last_touch") {
  const store = new InMemoryAffiliateStore();
  store.affiliates.set("aff_1", { id: "aff_1", code: "ALPHA", status: "active" });
  store.affiliates.set("aff_2", { id: "aff_2", code: "BETA", status: "active" });
  store.campaigns.set("camp_1", {
    id: "camp_1", name: "Default", attributionModel: model, cookieDays: 30,
    commissionType: "percentage", commissionValue: 1500n, recurringMonths: 12,
    minimumOrderAmount: 1000n, active: true,
  });
  return { store, engine: new AffiliateReferralEngine(store, new SequentialIdGenerator(), () => new Date("2026-01-31T00:00:00Z")) };
}

test("last-touch attribution creates a percentage commission", async () => {
  const { store, engine } = fixture();
  await engine.trackClick({ affiliateId: "aff_1", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-01") });
  await engine.trackClick({ affiliateId: "aff_2", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-10") });
  const commission = await engine.recordConversion({ idempotencyKey: "evt_1", conversionId: "order_1", campaignId: "camp_1", visitorId: "visitor", orderAmount: 10000n, occurredAt: new Date("2026-01-15") });
  assert.equal(commission?.affiliateId, "aff_2");
  assert.equal(commission?.amount, 1500n);
  assert.equal(store.commissions.size, 1);
});

test("first-touch attribution selects the earliest eligible click", async () => {
  const { engine } = fixture("first_touch");
  await engine.trackClick({ affiliateId: "aff_1", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-01") });
  await engine.trackClick({ affiliateId: "aff_2", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-10") });
  const commission = await engine.recordConversion({ idempotencyKey: "evt_2", conversionId: "order_2", campaignId: "camp_1", visitorId: "visitor", orderAmount: 10000n, occurredAt: new Date("2026-01-15") });
  assert.equal(commission?.affiliateId, "aff_1");
});

test("idempotency returns the original commission", async () => {
  const { store, engine } = fixture();
  await engine.trackClick({ affiliateId: "aff_1", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-01") });
  const input = { idempotencyKey: "evt_same", conversionId: "order", campaignId: "camp_1", visitorId: "visitor", orderAmount: 10000n, occurredAt: new Date("2026-01-15") };
  const first = await engine.recordConversion(input);
  const replay = await engine.recordConversion(input);
  assert.equal(first?.id, replay?.id);
  assert.equal(store.commissions.size, 1);
});

test("commission lifecycle supports approval, payable payout and reversal", async () => {
  const { engine } = fixture();
  await engine.trackClick({ affiliateId: "aff_1", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-01") });
  const commission = await engine.recordConversion({ idempotencyKey: "evt_3", conversionId: "order_3", campaignId: "camp_1", visitorId: "visitor", orderAmount: 20000n, occurredAt: new Date("2026-01-15") });
  await engine.transitionCommission(commission.id, "approved");
  await engine.transitionCommission(commission.id, "payable");
  const payout = await engine.createPayoutBatch("aff_1");
  assert.equal(payout.totalAmount, 3000n);
  const reversed = await engine.reverseCommission(commission.id, "chargeback");
  assert.equal(reversed.status, "reversed");
});

test("invalid lifecycle transition is rejected", async () => {
  const { engine } = fixture();
  await engine.trackClick({ affiliateId: "aff_1", campaignId: "camp_1", visitorId: "visitor", occurredAt: new Date("2026-01-01") });
  const commission = await engine.recordConversion({ idempotencyKey: "evt_4", conversionId: "order_4", campaignId: "camp_1", visitorId: "visitor", orderAmount: 10000n, occurredAt: new Date("2026-01-15") });
  await assert.rejects(engine.transitionCommission(commission.id, "paid"), InvalidTransitionError);
});
