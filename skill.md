# x402-concierge — agent skill

A meta-agent service: send one paid request describing several real-world tasks — book dinner, buy a gift, plan transit, book a hotel — and get back a single **signed composed itinerary** where every step carries the upstream service's artifact and its x402 payment receipt inline. The concierge pays the upstream suite services (default: `x402-agent-sandbox`) from its own wallet via `x402-fetch`; you pay the concierge once. Without a configured wallet it still works out of the box: upstream 402 quotes are captured and deterministic fixture artifacts (labeled `source: "fixture"`) are returned.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

**Base URL**: `{BASE_URL}` (self-hosted; default `http://localhost:4042`)

## Endpoints

### POST /plan — $0.02 (+ upstream passthrough paid by the concierge wallet)

Request body:
```json
{
  "tasks": [
    { "type": "dinner", "party": 4, "time": "2026-08-08T19:00:00Z" },
    { "type": "gift", "item": "flowers", "budgetUsd": 0.01 },
    { "type": "transit", "from": "Home", "to": "Luna Trattoria" },
    { "type": "hotel", "checkIn": "2026-08-08", "nights": 1 }
  ]
}
```
Supported `type` values: `dinner`, `hotel`, `gift`, `transit`. 1–8 tasks per plan. Extra fields are forwarded to the upstream service unchanged.

Response 200:
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
          "artifact": { "source": "fixture", "itineraryId": "trip_…", "legs": [ … ], "totalMinutes": 24 },
          "paymentReceipt": null,
          "note": "TRANSIT_URL not configured — returned a deterministic sample itinerary."
        }
      ],
      "summary": { "tasks": 2, "live": 1, "fixture": 1, "upstreamSandbox": "http://localhost:4038", "walletConfigured": true },
      "createdAt": "2026-08-08T12:00:00.000Z"
    },
    "signature": "hex-hmac-sha256",
    "algorithm": "HMAC-SHA256",
    "canonicalization": "sorted-json"
  },
  "conciergeFee": {
    "success": true, "rail": "solana", "network": "solana",
    "transaction": "5xY…", "payer": "7hF…", "amount": "20000", "asset": "USDC"
  }
}
```

Step `mode` semantics:
- `live` — the upstream call succeeded; `artifact` is the upstream's real response and `paymentReceipt` is the decoded `X-PAYMENT-RESPONSE` settlement (when the route was paid).
- `fixture` — the upstream was unreachable or unpaid; `artifact` is a deterministic, schema-compatible fixture (`source: "fixture"`), and `quotedRequirements` carries the upstream's 402 price quote when one was received.

### GET /config — free
Current upstream wiring: sandbox URL, optional transit URL, whether a concierge wallet is configured.

### POST /verify — free
Body `{payload, signature}` → `{valid: true|false}` for any artifact signed by this server.

### GET /healthz — free

## Payment — dual rail
Protocol: **x402** (HTTP 402). Asset: **USDC** on both rails. A 402 response carries an `accepts` array with two entries; send `X-PAYMENT` for whichever you can pay.

| Rail | `network` | Asset address | payTo | Facilitator |
|---|---|---|---|---|
| EVM | `base-sepolia` (`base` via `NETWORK`) | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` | `https://x402.org/facilitator` |
| Solana | `solana` (`solana-devnet` via `SOLANA_NETWORK`) | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` | `https://facilitator.payai.network` |

Flow: request → `402` with `accepts[]` → pick your rail → sign the USDC authorization (EIP-3009 on Base, fee-sponsored SPL `transferChecked` on Solana; `extra.feePayer` sponsors the SOL fee so you need no SOL) → retry with `X-PAYMENT` → `200` with the artifact in-body plus an `X-PAYMENT-RESPONSE` header (`{success, rail, network, facilitator, transaction, payer, amount, asset}`), echoed in the response body as `conciergeFee`.

**Two payment layers.** You pay the concierge on your rail of choice. The concierge separately pays each upstream from its own wallet on the EVM rail (`CONCIERGE_PRIVATE_KEY`); those settlements come back to you as `steps[].paymentReceipt`, so one plan gives you a full, itemised payment trail across services.

## Error codes
| Status | Meaning |
|---|---|
| 400 | Invalid body — response includes a retry hint |
| 402 | Payment required — body carries x402 `PaymentRequirements` |
| 500 | Composition failed (`compose_failed` + detail), or `no_payment_rail` when neither rail is configured |
| 502 | `facilitator_unreachable` / `settlement_error` — the rail's facilitator failed; nothing was charged |

Machine-readable manifest (lists both rails per resource): `{BASE_URL}/.well-known/x402`

Contact: **nichxbt@gmail.com**
