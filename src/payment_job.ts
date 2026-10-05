import { randomUUID } from "node:crypto";
import { z } from "zod";
import { clientFromEnvironment, type InfraiClient, type LogEntry } from "./infrai_client.js";

export const paymentRequestSchema = z.object({
  payment_id: z.string().min(1),
  account_id: z.string().min(1),
  amount_minor: z.number().int().positive(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  billing_country: z.string().length(2),
  ip_country: z.string().length(2),
  notify_email: z.string().email(),
});

export type PaymentRequest = z.infer<typeof paymentRequestSchema>;
export type PaymentDecision = "approve" | "manual_review";

export function decidePayment(payment: PaymentRequest): PaymentDecision {
  const countryMismatch = payment.billing_country !== payment.ip_country;
  return payment.amount_minor >= 1_000_000 || countryMismatch
    ? "manual_review"
    : "approve";
}

function auditEntries(payment: PaymentRequest, decision: PaymentDecision, traceId: string): LogEntry[] {
  const common = {
    timestamp: new Date().toISOString(),
    service: "payment-risk-job",
    environment: "example",
    trace_id: traceId,
  } as const;
  const decisionEntry: LogEntry = {
    ...common,
    level: decision === "approve" ? "info" : "warn",
    message: "payment risk decision recorded",
    attributes: {
      event: "payment.decision",
      payment_id: payment.payment_id,
      account_id: payment.account_id,
      amount_minor: payment.amount_minor,
      currency: payment.currency,
      decision,
      country_mismatch: payment.billing_country !== payment.ip_country,
    },
  };
  const notificationEntry: LogEntry = {
    ...common,
    level: "info",
    message: "payment notification queued",
    attributes: {
      event: "notification.queued",
      payment_id: payment.payment_id,
      channel: "email",
      template: decision === "approve" ? "payment-confirmed" : "payment-reviewing",
    },
  };
  return [decisionEntry, notificationEntry];
}

export async function processPaymentBody(
  body: unknown,
  infrai: Pick<InfraiClient, "ingest">,
  traceId: string = randomUUID(),
): Promise<{ payment_id: string; decision: PaymentDecision; trace_id: string }> {
  const payment = paymentRequestSchema.parse(body);
  const decision = decidePayment(payment);
  await infrai.ingest(auditEntries(payment, decision, traceId), `payment:${payment.payment_id}`);
  return { payment_id: payment.payment_id, decision, trace_id: traceId };
}

async function main(): Promise<void> {
  const infrai = clientFromEnvironment();
  const result = await processPaymentBody({
    payment_id: `pay_${Date.now()}`,
    account_id: "acct_demo_42",
    amount_minor: 1_250_000,
    currency: "USD",
    billing_country: "US",
    ip_country: "GB",
    notify_email: "founder@example.com",
  }, infrai);

  const [matches, credential] = await Promise.all([
    infrai.search(result.payment_id),
    infrai.whoAmI(),
  ]);
  console.log(JSON.stringify({ result, matches, credential }, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
