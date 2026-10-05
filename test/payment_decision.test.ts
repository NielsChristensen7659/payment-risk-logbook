import assert from "node:assert/strict";
import test from "node:test";
import { processPaymentBody } from "../src/payment_job.js";

test("a country mismatch routes payment to review and writes an audit pair", async () => {
  const calls: Array<{ entries: unknown[]; idempotencyKey: string }> = [];
  const infrai = {
    async ingest(entries: unknown[], idempotencyKey: string) {
      calls.push({ entries, idempotencyKey });
      return {};
    },
  };

  const result = await processPaymentBody({
    payment_id: "pay_review_17",
    account_id: "acct_9",
    amount_minor: 4200,
    currency: "USD",
    billing_country: "US",
    ip_country: "CA",
    notify_email: "payer@example.com",
  }, infrai, "trace_fixed");

  assert.equal(result.decision, "manual_review");
  assert.equal(calls[0]?.idempotencyKey, "payment:pay_review_17");
  assert.equal(calls[0]?.entries.length, 2);
  assert.match(JSON.stringify(calls), /payment\.decision/);
  assert.doesNotMatch(JSON.stringify(calls), /payer@example\.com/);
});

test("an invalid currency is rejected before a log is written", async () => {
  let writes = 0;
  const infrai = { async ingest() { writes += 1; } };

  await assert.rejects(() => processPaymentBody({
    payment_id: "pay_bad_1",
    account_id: "acct_9",
    amount_minor: 4200,
    currency: "usd",
    billing_country: "US",
    ip_country: "US",
    notify_email: "payer@example.com",
  }, infrai));
  assert.equal(writes, 0);
});
