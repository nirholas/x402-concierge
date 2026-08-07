import { createHash } from "node:crypto";
import { canonicalize } from "./sign.js";

export type StepMode = "live" | "fixture";

export interface StepResult {
  task: string;
  upstream: string | null;
  mode: StepMode;
  artifact: unknown;
  /** Decoded X-PAYMENT-RESPONSE settlement receipt when the upstream call was paid live. */
  paymentReceipt: unknown | null;
  /** The upstream's 402 PaymentRequirements, included when we fell back to a fixture. */
  quotedRequirements?: unknown;
  note?: string;
}

export interface UpstreamConfig {
  sandboxUrl: string;
  transitUrl: string | null;
  walletConfigured: boolean;
}

export function upstreamConfig(): UpstreamConfig {
  return {
    sandboxUrl: (process.env.SANDBOX_URL ?? "http://localhost:4038").replace(/\/$/, ""),
    transitUrl: process.env.TRANSIT_URL ? process.env.TRANSIT_URL.replace(/\/$/, "") : null,
    walletConfigured: Boolean(process.env.CONCIERGE_PRIVATE_KEY),
  };
}

type PayFetch = (input: RequestInfo, init?: RequestInit) => Promise<Response>;

let cachedPayFetch: PayFetch | null | undefined;

/** x402-fetch wrapper around global fetch, funded by CONCIERGE_PRIVATE_KEY. Null when no wallet. */
async function getPayFetch(): Promise<PayFetch | null> {
  if (cachedPayFetch !== undefined) return cachedPayFetch;
  const key = process.env.CONCIERGE_PRIVATE_KEY;
  if (!key) {
    cachedPayFetch = null;
    return null;
  }
  const [{ wrapFetchWithPayment }, { privateKeyToAccount }] = await Promise.all([
    import("x402-fetch"),
    import("viem/accounts"),
  ]);
  const account = privateKeyToAccount(key as `0x${string}`);
  cachedPayFetch = wrapFetchWithPayment(fetch, account) as PayFetch;
  return cachedPayFetch;
}

export async function decodeReceiptHeader(res: Response): Promise<unknown | null> {
  const header = res.headers.get("x-payment-response");
  if (!header) return null;
  try {
    const { decodeXPaymentResponse } = await import("x402-fetch");
    return decodeXPaymentResponse(header);
  } catch {
    return { raw: header };
  }
}

/** Deterministic 16-hex id derived from arbitrary input — keeps fixtures reproducible. */
export function seededId(prefix: string, input: unknown): string {
  const digest = createHash("sha256").update(canonicalize(input)).digest("hex");
  return `${prefix}_${digest.slice(0, 16)}`;
}

export interface CallOutcome {
  ok: boolean;
  status?: number;
  body?: unknown;
  paymentReceipt?: unknown | null;
  quotedRequirements?: unknown;
  note?: string;
}

/**
 * Call an upstream x402 service. With a wallet configured the 402 is paid
 * automatically; without one, the 402's PaymentRequirements are captured as a
 * quote and the caller is expected to fall back to a fixture artifact.
 */
export async function callUpstream(url: string, init?: RequestInit): Promise<CallOutcome> {
  const payFetch = await getPayFetch();
  const doFetch = payFetch ?? fetch;
  try {
    const res = await doFetch(url, {
      ...init,
      signal: AbortSignal.timeout(10_000),
    } as RequestInit);
    const contentType = res.headers.get("content-type") ?? "";
    const body = contentType.includes("json") ? await res.json() : await res.text();
    if (res.ok) {
      return { ok: true, status: res.status, body, paymentReceipt: await decodeReceiptHeader(res) };
    }
    if (res.status === 402) {
      return {
        ok: false,
        status: 402,
        quotedRequirements: body,
        note: payFetch
          ? "Upstream 402 not settled — check the concierge wallet's USDC balance."
          : "No CONCIERGE_PRIVATE_KEY configured — captured the upstream 402 quote and used a fixture artifact.",
      };
    }
    return { ok: false, status: res.status, body, note: `Upstream returned ${res.status}.` };
  } catch (err) {
    return {
      ok: false,
      note: `Upstream unreachable (${err instanceof Error ? err.message : "error"}) — used a fixture artifact.`,
    };
  }
}

// ---------------------------------------------------------------------------
// Fixture artifacts — used when the upstream cannot be paid or reached.
// Deterministic (seeded by the task payload) and schema-compatible with
// x402-agent-sandbox, which itself mirrors the real suite merchants.
// ---------------------------------------------------------------------------

export function fixtureDinner(task: Record<string, unknown>): unknown {
  // Fixture data — used when CONCIERGE_PRIVATE_KEY is unset or the sandbox is unreachable
  return {
    source: "fixture",
    reservationId: seededId("resv", task),
    merchant: "Sandy's Sandbox Bistro",
    confirmedTime: task.time ?? "2026-01-01T19:00:00Z",
    party: task.party ?? 2,
    status: "confirmed",
    refundTerms: "Refundable hold — cancel ≥2h before seating for automatic refund.",
  };
}

export function fixtureHotel(task: Record<string, unknown>): unknown {
  // Fixture data — used when CONCIERGE_PRIVATE_KEY is unset or the sandbox is unreachable
  return {
    source: "fixture",
    bookingId: seededId("hotl", task),
    merchant: "Sandbox Grand Hotel",
    checkIn: task.checkIn ?? "2026-01-01",
    nights: task.nights ?? 1,
    roomType: "queen",
    status: "confirmed",
  };
}

export function fixtureGift(task: Record<string, unknown>): unknown {
  // Fixture data — used when CONCIERGE_PRIVATE_KEY is unset or the sandbox is unreachable
  return {
    source: "fixture",
    orderId: seededId("gift", task),
    merchant: "Sandbox General Store",
    item: task.item ?? "gift box",
    priceUsd: task.budgetUsd ?? 0.001,
    status: "confirmed",
    fulfillment: "Signed order confirmation — digital goods deliver in-response at the real merchant.",
  };
}

export function fixtureTransit(task: Record<string, unknown>): unknown {
  // Fixture data — used when TRANSIT_URL is unset or unreachable
  const from = String(task.from ?? "Origin");
  const to = String(task.to ?? "Destination");
  return {
    source: "fixture",
    itineraryId: seededId("trip", task),
    from,
    to,
    legs: [
      { mode: "walk", from, to: "Central Station", minutes: 7 },
      { mode: "metro", line: "A", from: "Central Station", to: "Market Square", minutes: 12 },
      { mode: "walk", from: "Market Square", to, minutes: 5 },
    ],
    totalMinutes: 24,
    note: "Deterministic sample itinerary. Point TRANSIT_URL at an x402-transit deployment for live GTFS plans.",
  };
}
