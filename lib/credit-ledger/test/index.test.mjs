import assert from "node:assert/strict";
import test from "node:test";
import {
  CreditLedger,
  CreditLedgerError,
  InMemoryCreditLedgerStore,
  InsufficientCreditsError,
  ReservationStateError,
  SequentialIdGenerator,
} from "../dist/index.js";

function createLedger() {
  return new CreditLedger(
    new InMemoryCreditLedgerStore(),
    new SequentialIdGenerator(),
    () => new Date("2026-01-01T00:00:00.000Z"),
  );
}

test("grant, debit and refund preserve an immutable balance", async () => {
  const ledger = createLedger();
  await ledger.grant({ accountId: "acct_1", amount: 100n });
  await ledger.debit({ accountId: "acct_1", amount: 35n });
  await ledger.refund({ accountId: "acct_1", amount: 10n });
  assert.deepEqual(await ledger.balance("acct_1"), {
    available: 75n,
    reserved: 0n,
    total: 75n,
  });
});

test("idempotency returns the original entry and prevents duplicate credit", async () => {
  const ledger = createLedger();
  const first = await ledger.grant({
    accountId: "acct_1",
    amount: 50n,
    idempotencyKey: "order_123",
  });
  const replay = await ledger.grant({
    accountId: "acct_1",
    amount: 50n,
    idempotencyKey: "order_123",
  });
  assert.equal(first.id, replay.id);
  assert.equal((await ledger.balance("acct_1")).available, 50n);
});

test("reservation capture consumes reserved credits", async () => {
  const ledger = createLedger();
  await ledger.grant({ accountId: "acct_1", amount: 100n });
  const reservation = await ledger.reserve({ accountId: "acct_1", amount: 40n });
  assert.deepEqual(await ledger.balance("acct_1"), {
    available: 60n,
    reserved: 40n,
    total: 100n,
  });
  const captured = await ledger.capture(reservation.id);
  assert.equal(captured.status, "captured");
  assert.deepEqual(await ledger.balance("acct_1"), {
    available: 60n,
    reserved: 0n,
    total: 60n,
  });
});

test("reservation release returns credits to availability", async () => {
  const ledger = createLedger();
  await ledger.grant({ accountId: "acct_1", amount: 100n });
  const reservation = await ledger.reserve({ accountId: "acct_1", amount: 40n });
  const released = await ledger.release(reservation.id, 15n);
  assert.equal(released.status, "open");
  assert.deepEqual(await ledger.balance("acct_1"), {
    available: 75n,
    reserved: 25n,
    total: 100n,
  });
  await ledger.release(reservation.id);
  assert.deepEqual(await ledger.balance("acct_1"), {
    available: 100n,
    reserved: 0n,
    total: 100n,
  });
});

test("ledger rejects invalid and overdrawn operations", async () => {
  const ledger = createLedger();
  await assert.rejects(
    ledger.grant({ accountId: "acct_1", amount: 0n }),
    CreditLedgerError,
  );
  await assert.rejects(
    ledger.debit({ accountId: "acct_1", amount: 1n }),
    InsufficientCreditsError,
  );
  await ledger.grant({ accountId: "acct_1", amount: 10n });
  const reservation = await ledger.reserve({ accountId: "acct_1", amount: 10n });
  await assert.rejects(
    ledger.capture(reservation.id, 11n),
    ReservationStateError,
  );
});
