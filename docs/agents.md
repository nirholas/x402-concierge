# For AI agents

x402-concierge is both a service an agent buys from *and* an agent itself: it discovers, pays, and composes other x402 services on your behalf, then hands you the whole transaction trail signed.

**Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge carries both requirements at the same price; send `X-PAYMENT` for whichever wallet you hold.

## Discovery

Two machine-readable entry points, served by every deployment:

1. **`/skill.md`** (also at the repo root) — a human-and-agent-readable skill file describing every endpoint, price, parameter, and response schema, following the agentres.dev skill.md pattern. Feed it to your agent as context and it knows how to use the service.
2. **`GET /.well-known/x402`** — a JSON manifest (`x402Version`, `payment.rails[]`, and `resources[]` with prices, both networks, per-rail `accepts`, and output schemas) in the discovery format indexed by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).

Also call **`GET /config`** (free) before paying: it tells you which upstreams a given deployment is wired to and whether it has a wallet, so you know whether you will get live artifacts or fixtures.

**Operators:** after deploying, submit your base URL to those indexes so agents can find you — x402scan crawls `/.well-known/x402` automatically once listed.

## Paying

Any x402-compatible client works. With `x402-fetch`:

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY));
const res = await payFetch("https://concierge.example/plan", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tasks: [
    { type: "dinner", party: 4, time: "2026-08-08T19:00:00Z" },
    { type: "gift", item: "flowers" },
    { type: "transit", from: "Home", to: "Luna Trattoria" },
  ] }),
});
const { plan } = await res.json();      // signed itinerary — keep it
```

The wrapper handles the 402 → sign → retry loop and enforces a max payment cap (default 0.10 USDC) so a misconfigured server can't drain the wallet. It selects the EVM entry from `accepts[]`.

### Solana rail

Read the entry whose `network` starts with `solana`, build a fee-sponsored SPL `transferChecked` for `maxAmountRequired` to the base58 `payTo`, sign it, and send the base64 x402 envelope as `X-PAYMENT`. `extra.feePayer` sponsors the SOL network fee, so a USDC balance is sufficient — no SOL required.

```ts
import { prepareSolanaCheckout, encodeX402Payment } from "@three-ws/x402-payment-modal/server";

const res = await fetch(url, { method: "POST", headers, body });   // → 402
const accept = (await res.json()).accepts.find((a) => a.network.startsWith("solana"));
const { tx_base64 } = await prepareSolanaCheckout({ accept, buyer: myPublicKey });
const { x_payment } = encodeX402Payment({
  accept, signedTxBase64: await wallet.signTransaction(tx_base64), resourceUrl: accept.resource,
});
const paid = await fetch(url, { method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body });
```

### Reading the settlement receipt

Every paid `200` carries `X-PAYMENT-RESPONSE`, base64 JSON: `{success, rail, network, facilitator, transaction, payer, amount, asset}` — also echoed in the body as `conciergeFee`. Use `rail` to record which chain your budget was drawn on.

## What you get back

One signed itinerary containing one step per task:

- **`artifact`** — the upstream service's real response. The reservation, the order confirmation, the trip plan. This is what you bought.
- **`paymentReceipt`** — the settlement the concierge made with that upstream. Together with `conciergeFee` this is a complete, itemised record: what you paid the concierge, and what the concierge paid on your behalf.
- **`mode`** — `live` or `fixture`. On `fixture`, `quotedRequirements` carries the upstream's 402 so you can price a live run, and `note` says why the fallback happened.
- **`signature`** — HMAC-SHA256 over the canonical JSON of the payload. Re-verify any time via `POST /verify` (free), or hold it as evidence.

Because a failing upstream degrades to a labeled fixture instead of failing the request, a paid call always returns a usable artifact — payment never disappears into a side effect.

## Budgeting

`POST /plan` costs $0.02 plus whatever the concierge spends upstream. Two ways to bound it:

1. Call `GET /config` first — no wallet configured means no passthrough spend at all.
2. Pass `budgetUsd` on the request; it is recorded on the itinerary as your stated ceiling.
3. Wrap your own fetch with [`x402-agent-wallet`](https://github.com/nirholas/x402-agent-wallet)'s policy checks for hard per-call and per-day caps.

## MCP integration

To give Claude this capability as a tool, see [`examples/mcp-tool.md`](https://github.com/nirholas/x402-concierge/blob/main/examples/mcp-tool.md) — a minimal MCP server exposing `plan_errands` and `concierge_config`, paying its own way via `x402-fetch`.

## Composing with the suite

The concierge is the composition layer: it is the thing that turns `x402-tablebook`, `x402-storefront`, `x402-transit` and the rest into a single call. Typical shapes:

- **Split the bill, then book**: `x402-group-pay` collects the money, the funded proof rides into a concierge plan.
- **Watch, then act**: `x402-price-watch` polls for a target price; when it hits, the concierge executes the plan.
- **Book, then improve**: `x402-rebooker` scans your confirmed itinerary for better options.

Questions or integration help: **nichxbt@gmail.com**
