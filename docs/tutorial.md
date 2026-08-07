# Tutorial — from clone to a composed, paid itinerary

This walkthrough takes you from `git clone` to a signed itinerary containing several upstream artifacts and their payment receipts.

Every paid route here accepts **USDC on Base or USDC on Solana** — the 402 challenge lists both and the client picks. The walkthrough uses the Base Sepolia testnet rail because it is the easiest to fund; step 7 covers the Solana rail and mainnet.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-concierge
cd x402-concierge
npm install
```

Requires Node 18+.

## 2. Configure

```bash
cp .env.example .env
```

`.env.example` ships pre-filled with the x402 Suite's public receive addresses, so **the server runs with no edits**. To receive the money yourself, replace both:

```
# EVM (Base / Base Sepolia) USDC receive address
PAY_TO_ADDRESS=0xYourReceivingWallet
# Solana USDC receive address
SOLANA_PAY_TO_ADDRESS=YourBase58SolanaWallet
```

The server logs a note at startup while the suite defaults are still in use.

The other variables control what the concierge *composes*:

| Var | Default | Effect |
|---|---|---|
| `SANDBOX_URL` | `http://localhost:4038` | The x402-agent-sandbox deployment providing `/restaurant/book`, `/hotel/book`, `/store/buy` |
| `TRANSIT_URL` | unset | An `x402-transit` deployment for live GTFS trip plans |
| `CONCIERGE_PRIVATE_KEY` | unset | The wallet the concierge pays upstreams with. Unset = fixture fallback |
| `SIGNING_SECRET` | dev default | HMAC key for signing itineraries |

None of these are required. With all of them unset the concierge still returns a complete, signed, deterministic itinerary — it just labels the artifacts `source: "fixture"` and includes the upstream's 402 price quote so you can see what a live run would have cost.

## 3. Run the server

```bash
npm run dev
```

The startup banner lists both payment rails and the upstream wiring:

```
  Payment rails (client picks one):
    evm     base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402
            facilitator: https://x402.org/facilitator
    solana  solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
            facilitator: https://facilitator.payai.network
  sandbox:     http://localhost:4038
  wallet:      not set (fixture fallback)
```

Confirm the wiring at any time:

```bash
curl -s http://localhost:4021/config | jq
```

## 4. Your first 402

```bash
curl -si -X POST http://localhost:4021/plan \
  -H 'content-type: application/json' \
  -d '{"tasks":[{"type":"dinner","party":4},{"type":"gift","item":"flowers"}]}'
```

You get `HTTP/1.1 402 Payment Required` and a JSON body whose `accepts[]` array holds **two** x402 `PaymentRequirements` — one per rail, same price:

```bash
curl -s -X POST http://localhost:4021/plan \
  -H 'content-type: application/json' -d '{"tasks":[{"type":"dinner","party":4}]}' \
  | jq '.accepts[] | {network, payTo, asset, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x4025…2402", "asset": "0x036C…CF7e", "maxAmountRequired": "20000" }
{ "network": "solana",       "payTo": "Wwwu…T3WwW", "asset": "EPjF…TDt1v", "maxAmountRequired": "20000" }
```

`maxAmountRequired` is USDC base units (6 decimals), so `"20000"` = $0.02. Nothing was charged; this is the price quote.

## 5. A paid call

Fund a wallet with Base Sepolia USDC from https://faucet.circle.com, then:

```bash
PRIVATE_KEY=0xThatWalletsKey npm run client
```

`examples/agent-client.ts` wraps `fetch` with `x402-fetch`, which intercepts the 402, picks the EVM entry from `accepts[]`, signs an EIP-3009 USDC transfer authorization for exactly $0.02, retries with the `X-PAYMENT` header, and hands you the 200.

## 6. Reading the artifact

The paid response is a signed itinerary. Every task you asked for produced exactly one step:

```json
{
  "task": "dinner",
  "upstream": "http://localhost:4038/restaurant/book",
  "mode": "live",
  "artifact": { "reservationId": "resv_…", "confirmedTime": "…", "status": "confirmed" },
  "paymentReceipt": { "success": true, "transaction": "0x…", "network": "base-sepolia" }
}
```

Three things to look at:

- **`artifact`** — the upstream's real response, verbatim. This is the thing you bought: the reservation, the order, the trip plan.
- **`paymentReceipt`** — what the concierge paid that upstream, decoded from its `X-PAYMENT-RESPONSE`. This is the passthrough half of the "$0.02 + passthrough" price.
- **`mode`** — `live` or `fixture`. On `fixture`, `quotedRequirements` holds the upstream's 402 so you can see the price you did not pay, and `note` explains why.

The whole payload is signed:

```bash
curl -s -X POST http://localhost:4021/verify \
  -H 'content-type: application/json' -d "$(jq -c '.plan' plan.json)"
# {"valid":true}
```

And `conciergeFee` (also the `X-PAYMENT-RESPONSE` header) tells you which rail *your* $0.02 settled on:

```bash
echo "<X-PAYMENT-RESPONSE value>" | base64 -d | jq
# { "success": true, "rail": "solana", "network": "solana", "transaction": "5xY…" }
```

## 7. Paying on the Solana rail

The second `accepts[]` entry is the Solana rail. Its `extra.feePayer` is the facilitator account that sponsors the SOL network fee, so a payer needs **only USDC** — no SOL for gas.

Build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. The payment modal's server helpers do the building and encoding:

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const res = await fetch(`${BASE}/plan`, { method: "POST", headers, body });   // → 402
const accept = (await res.json()).accepts.find((a) => a.network.startsWith("solana"));

const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(`${BASE}/plan`, { method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body });
```

To test on devnet instead of mainnet, set `SOLANA_NETWORK=devnet`.

## 8. Going live

1. **Point at real merchants.** `SANDBOX_URL` can be any deployment exposing the three booking routes — swap the sandbox for `x402-tablebook`, `x402-storefront`, and friends. Set `TRANSIT_URL` for real transit plans.
2. **Fund the concierge.** Set `CONCIERGE_PRIVATE_KEY` to a wallet with USDC. Steps flip from `fixture` to `live` and every upstream payment comes back as a receipt.
3. **EVM rail**: set `NETWORK=base` and point `FACILITATOR_URL` at a mainnet-capable facilitator (the default x402.org facilitator settles testnets).
4. **Solana rail**: already mainnet by default (`SOLANA_NETWORK=mainnet-beta`, PayAI facilitator). Nothing to change.
5. Set a strong `SIGNING_SECRET` and real receiving wallets for `PAY_TO_ADDRESS` / `SOLANA_PAY_TO_ADDRESS`.

Want a single rail? Unset the other rail's `payTo`; it is dropped from `accepts` with a startup warning and the remaining rail keeps working.

Prices stay in dollar strings (`$0.02`); the middleware converts to USDC base units per network, so both rails always quote the same price.
