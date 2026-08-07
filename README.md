# x402-concierge

> Meta-agent that composes paid skills — dinner + gift + transit in one request, with per-step receipts, powered by the suite.

![License](https://img.shields.io/badge/license-Apache--2.0-blue)
![x402](https://img.shields.io/badge/payments-x402%20%2F%20USDC-0052ff)
![rails](https://img.shields.io/badge/rails-Base%20%2B%20Solana-9945ff)
![Node](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)

> **Pay in USDC on Base or Solana — your client picks the rail.** Every 402 challenge lists both.

One paid request, several real-world errands. `POST /plan` takes a list of tasks — book dinner, buy a gift, plan the transit between them, book a hotel — calls the corresponding x402 services, pays each one, and returns a **single signed itinerary with every upstream artifact and its settlement receipt inline**. You pay the concierge once and get back the whole paper trail.

It works out of the box: the default upstream is [`x402-agent-sandbox`](https://github.com/nirholas/x402-agent-sandbox), and when no concierge wallet is configured the upstream 402 quotes are captured and deterministic fixtures (labeled `source: "fixture"`) are returned in their place.

## Why x402 for this

Composition is where per-request payment stops being a nicety. To orchestrate four merchants the old way you need four accounts, four API keys, four billing relationships, and a business-development conversation before a single line of code. With x402 the concierge discovers a price at call time, pays it, and moves on — so adding a merchant to a plan is a URL, not a contract. And because each settlement is its own on-chain receipt, the composed itinerary is auditable end to end: you can see exactly what was spent, with whom, and on which chain.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-concierge && cd x402-concierge
npm install
cp .env.example .env        # pre-filled — runs with no edits
npm run dev                 # server on http://localhost:4042
```

Then run the full paid flow with a wallet holding [Base Sepolia USDC](https://faucet.circle.com):

```bash
PRIVATE_KEY=0x... npm run client
```

To receive the fees yourself, set `PAY_TO_ADDRESS` (Base) and `SOLANA_PAY_TO_ADDRESS` (Solana) in `.env` — the server logs a note while the suite defaults are in use.

## API

| Route | Price | What you get back |
|---|---|---|
| `POST /plan` | $0.02 + upstream passthrough | Signed composed itinerary: every step's artifact + payment receipt inline |
| `GET /config` | free | Current upstream wiring and whether a concierge wallet is configured |
| `POST /verify` | free | Signature check for any itinerary issued here |
| `GET /healthz` | free | Liveness + the rails this deployment accepts |

Task types: `dinner`, `hotel`, `gift`, `transit` (1–8 per plan). Unknown fields on a task are forwarded to the upstream service unchanged.

```bash
curl -X POST http://localhost:4042/plan -H 'content-type: application/json' -d '{
  "tasks": [
    { "type": "dinner", "party": 4, "time": "2026-08-08T19:00:00Z" },
    { "type": "gift", "item": "flowers", "budgetUsd": 0.01 },
    { "type": "transit", "from": "Home", "to": "Luna Trattoria" }
  ]
}'
```

## How x402 works — two rails, one flow

1. Client calls a paid route → server responds `402 Payment Required` with an `accepts` array holding **both** payment requirements: USDC on Base (EVM) and USDC on Solana (SVM), same price, same resource.
2. Client picks the rail its wallet supports and authorizes exactly that amount — an EIP-3009 transfer authorization on Base, or a fee-sponsored SPL `transferChecked` on Solana — then retries with the `X-PAYMENT` header.
3. The server reads `network` off the payload, selects the matching requirement, and verifies + settles through that rail's facilitator (x402.org for Base, PayAI for Solana by default).
4. Server responds `200` with the artifact in-body and an `X-PAYMENT-RESPONSE` header carrying the settlement receipt (`rail`, `network`, `facilitator`, `transaction`, `payer`).

Solana buyers need no SOL: the facilitator's `feePayer` sponsors the network fee, so a USDC balance is enough. `x402-fetch` does steps 2–3 automatically — see [`examples/agent-client.ts`](examples/agent-client.ts) and [`examples/curl.md`](examples/curl.md).

**Two payment layers.** You pay the concierge on your rail. The concierge pays each upstream from its own wallet (`CONCIERGE_PRIVATE_KEY`, EVM rail) and returns those settlements to you as `steps[].paymentReceipt`.

## Real backend / API keys

The concierge composes **real x402 services** — it is a client of the suite, not a mock. What is live depends on two things:

- `SANDBOX_URL` — defaults to `http://localhost:4038` ([`x402-agent-sandbox`](https://github.com/nirholas/x402-agent-sandbox)), which provides `POST /restaurant/book`, `/hotel/book`, `/store/buy`. Point it at any x402 deployment with those routes. Swap in the real merchants (`x402-tablebook`, `x402-storefront`, …) by URL.
- `TRANSIT_URL` — optional `x402-transit` deployment for live GTFS trip plans.
- `CONCIERGE_PRIVATE_KEY` — the wallet the concierge pays upstreams with. **Unset by default**: the concierge still calls each upstream, captures the 402 price quote into `steps[].quotedRequirements`, and returns a deterministic fixture artifact marked `source: "fixture"`. No paid key is ever required to run the demo.

Payment envs: `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`/`FACILITATOR_URL` (EVM rail), `SOLANA_NETWORK`/`SOLANA_FACILITATOR_URL` (Solana rail). A rail whose address is missing or malformed is dropped from `accepts` with a startup warning — the other rail keeps working. `SIGNING_SECRET` is the HMAC key for itineraries; a dev fallback (with console warning) keeps the demo keyless.

## For AI agents

- **[skill.md](skill.md)** — agent-facing skill file: endpoints, prices, schemas, payment instructions.
- **`GET /.well-known/x402`** — machine-readable manifest, both rails per resource, indexable by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market).
- **MCP**: [`examples/mcp-tool.md`](examples/mcp-tool.md) exposes `plan_errands` as a Claude tool that pays per call.

An agent with a $0.02 budget line can hand off an entire evening's logistics in one call and receive a signed, itemised record of what it bought.

## Docs

Full docs on GitHub Pages: **https://nirholas.github.io/x402-concierge/** — [tutorial](https://nirholas.github.io/x402-concierge/tutorial), [API reference](https://nirholas.github.io/x402-concierge/api), [agents guide](https://nirholas.github.io/x402-concierge/agents).

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, deployments, or a rail you want added: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
