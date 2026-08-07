# API reference

Base URL: your deployment (default `http://localhost:4021`). Machine-readable: [`openapi.json`](https://github.com/nirholas/x402-concierge/blob/main/openapi.json) · [`/.well-known/x402`](https://github.com/nirholas/x402-concierge/blob/main/public/.well-known/x402).

All paid routes follow x402: unpaid request → `402` + `PaymentRequirements`; request with a valid `X-PAYMENT` header → `200` + artifact + `X-PAYMENT-RESPONSE`.

## Payment rails

Every paid route is **dual rail** — the 402 body's `accepts[]` holds one entry per rail at the same price, and the server settles whichever one your `X-PAYMENT` payload names in its `network` field.

| Rail | `network` | Asset | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (default), `base` | USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (default), `solana-devnet` | USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

The Solana entry carries `extra.feePayer` — the facilitator account that sponsors the SOL network fee, so payers need only USDC.

**402 body**

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "20000",
      "resource": "https://host/plan", "description": "…", "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "20000",
      "resource": "https://host/plan", "description": "…", "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" } }
  ]
}
```

**`X-PAYMENT-RESPONSE`** (on every paid `200`) is base64 JSON, and is echoed in the body as `conciergeFee`:

```json
{ "success": true, "rail": "solana", "network": "solana",
  "transaction": "5xY…", "payer": "7hF…", "amount": "20000", "asset": "USDC" }
```

---

## POST /plan — $0.02 (+ upstream passthrough)

Compose several agentic-commerce tasks in one paid request.

**Body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `tasks` | array | yes | 1–8 task objects |
| `tasks[].type` | string | yes | `dinner` \| `hotel` \| `gift` \| `transit` |
| `budgetUsd` | number | no | Advisory ceiling recorded on the request |

Any additional field on a task is forwarded to the upstream service unchanged, so `{"type":"dinner","party":4,"time":"…","seating":"outdoor"}` works the moment the upstream understands `seating`.

Common per-type fields:

| Type | Fields | Upstream route |
|---|---|---|
| `dinner` | `party`, `time` | `POST {SANDBOX_URL}/restaurant/book` |
| `hotel` | `checkIn`, `nights` | `POST {SANDBOX_URL}/hotel/book` |
| `gift` | `item`, `budgetUsd` | `POST {SANDBOX_URL}/store/buy` |
| `transit` | `from`, `to` | `GET {TRANSIT_URL}/plan` |

**200**

```json
{
  "plan": {
    "payload": {
      "planId": "plan_9f8e7d6c5b4a3210",
      "requested": [ { "type": "dinner", "party": 4, "time": "…" } ],
      "steps": [
        {
          "task": "dinner",
          "upstream": "http://localhost:4038/restaurant/book",
          "mode": "live",
          "artifact": { "reservationId": "…", "confirmedTime": "…", "party": 4, "status": "confirmed" },
          "paymentReceipt": { "success": true, "transaction": "0x…", "network": "base-sepolia" }
        },
        {
          "task": "transit",
          "upstream": null,
          "mode": "fixture",
          "artifact": { "source": "fixture", "itineraryId": "trip_…", "legs": [], "totalMinutes": 24 },
          "paymentReceipt": null,
          "note": "TRANSIT_URL not configured — returned a deterministic sample itinerary."
        }
      ],
      "summary": {
        "tasks": 2, "live": 1, "fixture": 1,
        "upstreamSandbox": "http://localhost:4038", "walletConfigured": true
      },
      "createdAt": "2026-08-08T12:00:00.000Z"
    },
    "signature": "hex", "algorithm": "HMAC-SHA256", "canonicalization": "sorted-json"
  },
  "conciergeFee": { "success": true, "rail": "solana", "network": "solana",
                    "transaction": "5xY…", "payer": "7hF…", "amount": "20000", "asset": "USDC" }
}
```

**Step `mode` semantics**

- `live` — the upstream call succeeded. `artifact` is the upstream response verbatim; `paymentReceipt` is its decoded `X-PAYMENT-RESPONSE` when the route was paid.
- `fixture` — the upstream was unreachable, or returned a 402 the concierge could not pay. `artifact` is a deterministic, schema-compatible stand-in marked `source: "fixture"`, `quotedRequirements` carries the upstream 402 quote when one arrived, and `note` explains why.

Steps run in order, so receipts stay in the order you listed the tasks. A failing step never fails the plan — you always get one artifact per task, which is why the paid response is never empty.

**Errors**: `400` invalid body (includes a retry hint), `402` unpaid, `500` `compose_failed`.

---

## GET /config — free

```json
{
  "upstreams": {
    "sandbox": {
      "url": "http://localhost:4038",
      "routes": ["POST /restaurant/book", "POST /hotel/book", "POST /store/buy"],
      "note": "x402-agent-sandbox — default upstream so the concierge works out of the box"
    },
    "transit": { "url": null, "note": "set TRANSIT_URL to an x402-transit deployment for live plans" }
  },
  "walletConfigured": false,
  "mode": "fixture fallback — upstream 402 quotes are captured, artifacts are deterministic fixtures"
}
```

Call this first to know what a plan will actually do before paying for one.

---

## POST /verify — free

Body: `{"payload": …, "signature": "hex"}` → `{"valid": true|false}`. Works on any itinerary this server signed.

## GET /healthz — free

`{"ok":true,"service":"x402-concierge","rails":[{"rail":"evm","network":"base-sepolia"},{"rail":"solana","network":"solana"}]}`

## Signature scheme

`signature = HMAC-SHA256(SIGNING_SECRET, canonicalJson(payload))` where `canonicalJson` recursively sorts object keys and strips `undefined`. See `src/sign.ts` (`sign`, `verify`, `canonicalize`).

## Error codes

| Status | Meaning |
|---|---|
| 400 | Invalid body — response includes a retry hint |
| 402 | Payment required, or the payment failed verification/settlement. Body carries the dual-rail `accepts[]` and an `error` reason |
| 500 | `compose_failed`, or `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |
