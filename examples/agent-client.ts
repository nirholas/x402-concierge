/**
 * Full x402 flow against x402-concierge, EVM rail (primary).
 *
 * The paid route is DUAL RAIL: the 402 challenge lists USDC on Base and USDC on
 * Solana at the same price, and you pay with whichever you hold. This example
 * uses `x402-fetch` + `viem`, which handles the Base rail. See the "Solana rail"
 * note at the bottom of this file for the SVM path.
 *
 * Flow:
 *   POST /plan (paid, $0.02 + upstream passthrough) — dinner + gift + transit in one request.
 *
 * Usage:
 *   PRIVATE_KEY=0x... BASE_URL=http://localhost:4042 npm run client
 *
 * PRIVATE_KEY must hold Base Sepolia USDC (faucet: https://faucet.circle.com).
 * Tip: run x402-agent-sandbox on port 4038 and set CONCIERGE_PRIVATE_KEY on the
 * server to watch every step go "live" with its own settlement receipt.
 */
import { config } from "dotenv";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";

config();

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4042";
const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("Set PRIVATE_KEY (0x… key of a wallet holding Base Sepolia USDC).");
  process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);
const payFetch = wrapFetchWithPayment(fetch, account);

async function main(): Promise<void> {
  console.log(`agent wallet: ${account.address}`);

  const configRes = await fetch(`${BASE_URL}/config`);
  console.log("\nconcierge config:", JSON.stringify(await configRes.json(), null, 2));

  const res = await payFetch(`${BASE_URL}/plan`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tasks: [
        { type: "dinner", party: 4, time: "2026-08-08T19:00:00Z" },
        { type: "gift", item: "flowers", budgetUsd: 0.01 },
        { type: "transit", from: "Home", to: "Luna Trattoria" },
      ],
    }),
  });

  const body = await res.json();
  const plan = body.plan?.payload;
  console.log(`\ncomposed plan ${plan?.planId} (${plan?.summary?.live} live / ${plan?.summary?.fixture} fixture):`);
  for (const step of plan?.steps ?? []) {
    console.log(`\n— ${step.task} [${step.mode}] ${step.upstream ?? ""}`);
    console.log("  artifact:", JSON.stringify(step.artifact));
    if (step.paymentReceipt) console.log("  upstream receipt:", JSON.stringify(step.paymentReceipt));
    if (step.note) console.log("  note:", step.note);
  }

  const header = res.headers.get("x-payment-response");
  if (header) {
    console.log("\nX-PAYMENT-RESPONSE (concierge settlement):", JSON.stringify(decodeXPaymentResponse(header)));
  }

  const verifyRes = await fetch(`${BASE_URL}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body.plan),
  });
  console.log("\nplan signature valid:", (await verifyRes.json()).valid);
}

main().catch((err) => {
  console.error("agent-client failed:", err);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * Solana rail — the same route, paid with USDC on Solana.
 *
 * The 402 body's `accepts` array has a second entry with `network: "solana"`, a
 * base58 `payTo`, the USDC mint as `asset`, and `extra.feePayer` — the
 * facilitator account that sponsors the SOL network fee, so your wallet needs
 * only USDC. Build a fee-sponsored SPL `transferChecked` for
 * `maxAmountRequired`, sign it, and send it base64-encoded as `X-PAYMENT`:
 *
 *   const challenge = await (await fetch(`${BASE_URL}/plan`, {
 *     method: "POST", headers, body,
 *   })).json();
 *   const solana = challenge.accepts.find((a: any) => a.network.startsWith("solana"));
 *
 *   //   import { prepareSolanaCheckout, encodeX402Payment }
 *   //     from "@three-ws/x402-payment-modal/server";
 *   //   const { tx_base64 } = await prepareSolanaCheckout({ accept: solana, buyer: myPubkey });
 *   //   const signed = await wallet.signTransaction(tx_base64);
 *   //   const { x_payment } = encodeX402Payment({
 *   //     accept: solana, signedTxBase64: signed, resourceUrl: solana.resource,
 *   //   });
 *   //   await fetch(`${BASE_URL}/plan`, {
 *   //     method: "POST", headers: { ...headers, "X-PAYMENT": x_payment }, body,
 *   //   });
 *
 * And the raw dual-rail 402 body, for reference:
 *
 *   curl -s -X POST http://localhost:4042/plan \
 *     -H 'content-type: application/json' -d '{"tasks":[{"type":"dinner","party":4}]}' \
 *     | jq '.accepts[] | {network, payTo, maxAmountRequired}'
 *
 *   { "network": "base-sepolia", "payTo": "0x4025…2402", "maxAmountRequired": "20000" }
 *   { "network": "solana",       "payTo": "Wwwu…T3WwW", "maxAmountRequired": "20000" }
 *
 * Note the two payment layers: this is what YOU pay the concierge. What the
 * concierge paid each upstream comes back inside plan.payload.steps[].paymentReceipt.
 * ------------------------------------------------------------------------- */
