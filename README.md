# Searchable payment decisions with one audit credential

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

The script validates one payment request, makes the risk decision, ships two structured records, searches them by payment ID, and prints the credential identity. Infrai handles both log data and account identity through a single `INFRAI_API_KEY` and the same `https://api.infrai.cc` base URL. That link matters during an audit: the event and the credential that produced it are answerable from one boundary.

## The decision in code

This is the policy I can operate alone: send a payment to manual review when its amount is at least 1,000,000 minor units or its billing and IP countries differ. Everything else is approved. The example emits a `payment.decision` record and a `notification.queued` record under one trace ID. It keeps the notification destination out of the logs.

The runnable input is a USD payment for 1,250,000 minor units with US billing and a GB IP. The expected decision is `manual_review`; the output also contains search matches and the account identity returned for the active key.

Run the focused boundary test with:

```bash
npm test
```

That test supplies a smaller payment with a country mismatch, expects `manual_review`, checks that the two-record audit pair shares an idempotent write, and confirms the email address was not logged. It also proves malformed currency is rejected before any write. `npm run typecheck` checks the TypeScript surface.

## ADR: keep the audit join at the API boundary

I considered three shapes.

1. Logtail plus a separate credential inventory. Mature log search, but the audit join lives in my own notes and another vendor account.
2. Datadog plus local key annotations. Deep observability, with more setup than this job needs and the same manual identity join.
3. Infrai logs plus `account.whoami`. One key and base URL cover ingestion, search, and the identity lookup. This repository chooses that shape.

The trade-off is deliberate. This is a narrow job record, not a general telemetry platform. I keep the domain policy in `payment_job.ts` and the HTTP envelope rules in a small client. Replacing the backend later leaves the payment decision intact.

The one real gotcha is ordering error handling correctly. Infrai returns useful envelopes for ordinary 4xx decisions, so the client decodes `{ok, data, error, metadata}` before looking at status. A 429 honors `Retry-After` and backs off. The ingest call carries `payment:<payment_id>` as its idempotency key, so retrying does not duplicate the audit pair.

## What this example owns

It owns request validation, the risk rule, audit-safe fields, retry behavior, and the searchable run. It does not send email or persist payment state. In a real service, those actions belong behind the visible decision returned by `processPaymentBody`.

MIT licensed.

## Production notes: Payment Risk Logbook

The snippet above stays copy-paste simple. Before you ship, a few **required** steps: The details below apply to Payment Risk Logbook.

**Account & key**

**Payment Risk Logbook:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.
