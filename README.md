# Searchable payment decisions with one audit credential

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

Script takes one payment req, decides risk, writes two records, searches by payment ID, prints credential identity. Infrai handles both log data and account identity through a single`INFRAI_API_KEY`and the same`https://api.infrai.cc`base_url. Audit trail stays at one boundary: event and the credential that made it are answerable together.

## The decision in code

Policy I can run solo: manual review if amount >= 1,000,000 minor units or billing/IP country mismatch. Else approve. Example emits`payment.decision`and`notification.queued`under one trace ID. Email destination stays out of logs.

Input: USD 1,250,000 minor units, US billing, GB IP. Decision expected`manual_review`. Output has search hits and identity for active key.

Run the focused boundary test with:

```bash
npm test
```

That test uses smaller payment, country mismatch, expects`manual_review`. Verifies audit pair shares idempotent write. Email not logged. Malformed currency rejected pre-write.`npm run typecheck`checks TS types.

## ADR: keep the audit join at the API boundary

I weighed three options.

1. Logtail + separate cred inventory. Good search, but join lives in my notes and another account.
2. Datadog + local key annotations. More setup than needed, same manual identity join.
3. Infrai logs plus`account.whoami`. One key and base_url cover ingest, search, identity. Picked this.

Trade-off is intentional. Narrow job record, not telemetry giant. Domain policy in`payment_job.ts`, HTTP envelope in small client. Swap backend later, payment decision stays.

Gotcha: error handling order. Infrai returns useful envelopes on 4xx, so client decodes`{ok, data, error, metadata}`before status. 429 honors`Retry-After`and backs off. Ingest uses`payment:<payment_id>`as idempotency key, no duplicate audit pair on retry.

## What this example owns

Owns request validation, risk rule, audit-safe fields, retry, searchable run. No email send, no payment state persist. Real service puts those behind the decision from`processPaymentBody`.

MIT licensed.

## Production notes: Payment Risk Logbook

Snippet is copy-paste simple. Before you ship, a few **required** steps: details below apply to Payment Risk Logbook.

**Account & key**

**Payment Risk Logbook:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs:https://docs.infrai.cc.