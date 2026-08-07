# curl walkthrough — raw 402 → pay → 200

Start the server:

```bash
npm run dev        # boots with the suite's default receive addresses
```

Every paid route is **dual rail**: the 402 lists USDC on Base *and* USDC on Solana at the same price, and you pay with whichever wallet you have.

## 0. See what this deployment will actually do (free)

```bash
curl -s http://localhost:4042/config | jq
```

```json
{
  "upstreams": {
    "sandbox": { "url": "http://localhost:4038", "routes": ["POST /restaurant/book", "POST /hotel/book", "POST /store/buy"] },
    "transit": { "url": null, "note": "set TRANSIT_URL to an x402-transit deployment for live plans" }
  },
  "walletConfigured": false,
  "mode": "fixture fallback — upstream 402 quotes are captured, artifacts are deterministic fixtures"
}
```

## 1. Hit the paid route without payment → 402

```bash
curl -si -X POST http://localhost:4042/plan \
  -H 'content-type: application/json' \
  -d '{"tasks":[{"type":"dinner","party":4,"time":"2026-08-08T19:00:00Z"},{"type":"gift","item":"flowers"}]}'
```

Response (trimmed):

```
HTTP/1.1 402 Payment Required
Content-Type: application/json

{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "20000",
      "resource": "http://localhost:4042/plan",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "20000",
      "resource": "http://localhost:4042/plan",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USD Coin", "decimals": 6, "feePayer": "2wKupLR9q6wXYppw8Gr2NvWxKBUqm4PPJKkQfoxHDBg4" }
    }
  ]
}
```

The `accepts` array is the machine-readable price sheet, one entry per rail: `maxAmountRequired` is in USDC base units (6 decimals), `asset` is the USDC contract/mint on the named network. Pick one:

```bash
curl -s -X POST http://localhost:4042/plan \
  -H 'content-type: application/json' -d '{"tasks":[{"type":"dinner","party":4}]}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

## 2. Pay — on either rail

The `X-PAYMENT` header is a base64-encoded, wallet-signed authorization matching one of those entries. Hand-rolling it means EIP-712 (Base) or SPL transaction building (Solana) — use a client:

**Base / EVM**

```bash
PRIVATE_KEY=0x... npm run client       # examples/agent-client.ts does the full flow
```

Under the hood: parse the 402 → sign an EIP-3009 `transferWithAuthorization` for the exact amount → retry with `X-PAYMENT: <base64 payload>`.

**Solana**

Use any x402 Solana client, or `@three-ws/x402-payment-modal` in a browser. Under the hood: build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, have the wallet sign it, base64-encode the x402 envelope, retry with `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so your wallet needs only USDC.

The server reads `network` off your payload, picks the matching requirement, and settles on that rail.

## 3. Paid retry → 200 with the itinerary in-body

```
HTTP/1.1 200 OK
X-PAYMENT-RESPONSE: <base64 of {"success":true,"rail":"solana","network":"solana","facilitator":"https://facilitator.payai.network","transaction":"5xY…","payer":"7hF…","amount":"20000","asset":"USDC"}>

{
  "plan": {
    "payload": {
      "planId": "plan_…",
      "steps": [
        { "task": "dinner", "mode": "live", "artifact": { "reservationId": "…" },
          "paymentReceipt": { "success": true, "transaction": "0x…" } },
        { "task": "gift", "mode": "fixture", "artifact": { "source": "fixture", "orderId": "gift_…" },
          "quotedRequirements": { "accepts": [ … ] } }
      ],
      "summary": { "tasks": 2, "live": 1, "fixture": 1 }
    },
    "signature": "…"
  },
  "conciergeFee": { "success": true, "rail": "solana", "transaction": "5xY…" }
}
```

Decode the header to see which rail settled your fee:

```bash
echo "<header value>" | base64 -d | jq
```

## 4. Free routes need no payment

```bash
curl -s http://localhost:4042/config | jq
curl -s http://localhost:4042/healthz
curl -s http://localhost:4042/.well-known/x402 | jq
curl -s -X POST http://localhost:4042/verify \
  -H 'content-type: application/json' -d '{"payload":{…},"signature":"…"}'
```
