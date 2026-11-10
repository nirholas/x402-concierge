---
name: x402-concierge
description: Call the x402-concierge HTTP service to turn several real-world tasks (dinner, hotel, gift, transit) into one signed itinerary with an x402 receipt per step. Use when an agent needs to plan and pay for multi-part errands in one request.
---

# x402-concierge

x402-concierge is an Express service. One paid `POST /plan` request describes several tasks and returns a single HMAC-signed composed itinerary. Each step carries the upstream service's artifact and its payment receipt. The concierge pays the upstream suite services from its own wallet via `x402-fetch`; the caller pays the concierge once.

## Run it

No package is published and there is no hosted instance, so run it from a clone: `git clone https://github.com/nirholas/x402-concierge && cd x402-concierge`, then `npm install`, `cp .env.example .env`, and `npm run dev` (tsx `src/server.ts`). It listens on `PORT`, default 4042. For production use `npm run build` then `npm start`.

Key env vars: `PORT`, `SANDBOX_URL` (default `http://localhost:4038`, the upstream suite), `TRANSIT_URL` (optional transit upstream), `CONCIERGE_PRIVATE_KEY` (EVM wallet that pays upstreams), `SIGNING_SECRET`, `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`, `SOLANA_NETWORK`. Without `CONCIERGE_PRIVATE_KEY` the service still answers: it records upstream 402 quotes and returns deterministic fixture artifacts labeled `source: "fixture"`.

## Endpoints

- `POST /plan` ($0.02, plus upstream passthrough paid by the concierge wallet). Body `{"tasks": [...]}` with 1 to 8 tasks. Each task has `type` of `dinner`, `hotel`, `gift` or `transit`; extra fields are forwarded to the upstream unchanged.
- `GET /config` (free): upstream wiring and whether a concierge wallet is configured.
- `POST /verify` (free): body `{payload, signature}` returns `{valid}` for anything this server signed.
- `GET /healthz` (free).

Example body:

```json
{"tasks": [
  {"type": "dinner", "party": 4, "time": "2026-08-08T19:00:00Z"},
  {"type": "gift", "item": "flowers", "budgetUsd": 0.01},
  {"type": "transit", "from": "Home", "to": "Luna Trattoria"}
]}
```

The 200 response has `plan` (`payload`, `signature`, `algorithm: HMAC-SHA256`) and `conciergeFee` (the receipt for your payment). In `plan.payload.steps[]`, `mode: "live"` means the upstream call succeeded and `paymentReceipt` is its settlement. `mode: "fixture"` means the upstream was unreachable or unpaid; the artifact is a labeled sample and `quotedRequirements` may carry the upstream price quote. Never present a fixture step to the user as a real booking.

Errors: 400 invalid body, 402 payment required, 500 `compose_failed` or `no_payment_rail`, 502 `facilitator_unreachable` or `settlement_error` (nothing charged).

## Paying

Every paid route answers an unpaid request with HTTP 402 and a body whose `accepts` array lists two rails: USDC on Base (`base-sepolia` by default, `base` via `NETWORK`) and USDC on Solana (`solana` by default, `solana-devnet` via `SOLANA_NETWORK`). Pick the entry your wallet can sign, sign the USDC payment (EIP-3009 on Base, SPL `transferChecked` on Solana), and retry with the base64 `X-PAYMENT` header. The artifact is in the 200 body and the settlement receipt is in the `X-PAYMENT-RESPONSE` header. On the EVM rail `x402-fetch` with `viem` does this for you; `npm run client` runs `examples/agent-client.ts`, which reads `BASE_URL` and `PRIVATE_KEY`.

Discovery: `GET /.well-known/x402` lists routes, prices and rails, and `GET /skill.md` serves the repo's own reference. Paying moves real USDC on the configured network, so show the user the route, amount and rail first and wait for a yes before any paid call. Use a throwaway wallet on `base-sepolia` or `solana-devnet` for testing.
