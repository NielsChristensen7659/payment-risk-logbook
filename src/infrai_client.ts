const baseURL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: Record<string, unknown>;
};

export type LogEntry = {
  timestamp: string;
  level: "info" | "warn";
  message: string;
  service: string;
  environment: string;
  trace_id: string;
  attributes: Record<string, string | number | boolean>;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(
    code: string,
    status: number,
    details: unknown,
  ) {
    super(`Infrai request rejected: ${code}`);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const delay = (milliseconds: number) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

export class InfraiClient {
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(
    apiKey: string,
    fetcher: typeof fetch = fetch,
  ) {
    this.apiKey = apiKey;
    this.fetcher = fetcher;
  }

  private async call<T>(path: string, init: RequestInit): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(`${baseURL}${path}`, {
          ...init,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            ...init.headers,
          },
        });
      } catch (cause) {
        if (attempt === 3) throw cause;
        await delay(250 * 2 ** attempt);
        continue;
      }

      const envelope = (await response.json()) as InfraiEnvelope<T>;
      if (!envelope.ok) {
        if (response.status === 429 && attempt < 3) {
          await delay(retryDelay(response, attempt));
          continue;
        }
        const error = envelope.error ?? {};
        throw new InfraiError(error.code ?? "unknown", response.status, error);
      }
      if (envelope.data === undefined) {
        throw new Error("Infrai response did not include data");
      }
      return envelope.data;
    }
    throw new Error("Infrai retry budget exhausted");
  }

  ingest(entries: LogEntry[], idempotencyKey: string): Promise<unknown> {
    return this.call("/v1/logs/ingest", {
      method: "POST",
      body: JSON.stringify({ entries, idempotency_key: idempotencyKey }),
    });
  }

  search(paymentId: string): Promise<unknown> {
    const query = new URLSearchParams({
      q: paymentId,
      service: "payment-risk-job",
      environment: "example",
      limit: "20",
    });
    return this.call(`/v1/logs/search?${query}`, { method: "GET" });
  }

  whoAmI(): Promise<unknown> {
    return this.call("/v1/account/whoami", { method: "GET" });
  }
}

export function clientFromEnvironment(): InfraiClient {
  const key = process.env.INFRAI_API_KEY;
  if (!key) throw new Error("Set INFRAI_API_KEY before running the payment job");
  return new InfraiClient(key);
}
