import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { activeRails, paymentReceipt, paywall, usingSuiteDefaultPayTo } from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import { composePlan, validatePlanRequest } from "./service.js";
import { upstreamConfig } from "./upstream.js";
import { usingDevSecret, verify } from "./sign.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public");

const PORT = Number(process.env.PORT ?? 4042);

const PRICES: Record<string, string> = {
  "POST /plan": "$0.02",
};

const DESCRIPTIONS: Record<string, string> = {
  "POST /plan":
    "Compose dinner + gift + transit (+hotel) in one request; upstream artifacts and receipts returned inline",
};

const rails = activeRails();

const app = express();
app.use(express.json({ limit: "256kb" }));
app.use(paywall(PRICES, { service: "x402-concierge", descriptions: DESCRIPTIONS, schemas: ROUTE_SCHEMAS }));

// ---------- paid routes ----------

app.post("/plan", async (req, res) => {
  const { error, request } = validatePlanRequest(req.body);
  if (error || !request) {
    res.status(400).json({
      error,
      hint: 'POST body: {"tasks":[{"type":"dinner","party":4,"time":"…"},{"type":"gift","item":"flowers"},{"type":"transit","from":"…","to":"…"}]}',
    });
    return;
  }
  try {
    const signedPlan = await composePlan(request);
    res.status(200).json({
      plan: signedPlan,
      // The rail YOU paid the concierge fee on. Upstream steps carry their own
      // receipts inside plan.payload.steps[].paymentReceipt.
      conciergeFee: paymentReceipt(res),
    });
  } catch (err) {
    res.status(500).json({
      error: "compose_failed",
      detail: err instanceof Error ? err.message : String(err),
    });
  }
});

// ---------- free routes ----------

app.get("/config", (_req, res) => {
  const config = upstreamConfig();
  res.json({
    upstreams: {
      sandbox: {
        url: config.sandboxUrl,
        routes: ["POST /restaurant/book", "POST /hotel/book", "POST /store/buy"],
        note: "x402-agent-sandbox — default upstream so the concierge works out of the box",
      },
      transit: config.transitUrl
        ? { url: config.transitUrl, routes: ["GET /plan"] }
        : { url: null, note: "set TRANSIT_URL to an x402-transit deployment for live plans" },
    },
    walletConfigured: config.walletConfigured,
    mode: config.walletConfigured
      ? "live — upstream 402s are paid with the concierge wallet"
      : "fixture fallback — upstream 402 quotes are captured, artifacts are deterministic fixtures",
  });
});

app.post("/verify", (req, res) => {
  const { payload, signature } = req.body ?? {};
  if (payload === undefined || typeof signature !== "string") {
    res.status(400).json({ error: "body must be {payload, signature}" });
    return;
  }
  res.json({ valid: verify({ payload, signature }) });
});

app.get("/healthz", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-concierge",
    rails: rails.map((r) => ({ rail: r.rail, network: r.network })),
  });
});

app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json");
  res.sendFile(path.join(PUBLIC_DIR, ".well-known", "x402"));
});

// Agent-facing skill file lives at the repo root; serve it alongside the manifest.
app.get("/skill.md", (_req, res) => {
  res.type("text/markdown");
  res.sendFile(path.resolve(__dirname, "..", "skill.md"));
});

app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  const config = upstreamConfig();
  console.log(`x402-concierge listening on http://localhost:${PORT}`);
  console.log("  Payment rails (client picks one):");
  for (const rail of rails) {
    console.log(`    ${rail.rail.padEnd(7)} ${rail.network.padEnd(14)} USDC → ${rail.payTo}`);
    console.log(`            facilitator: ${rail.facilitator}`);
  }
  if (usingSuiteDefaultPayTo()) {
    console.log(
      "  NOTE: using suite default payTo — set PAY_TO_ADDRESS / SOLANA_PAY_TO_ADDRESS to receive funds yourself.",
    );
  }
  console.log(`  sandbox:     ${config.sandboxUrl}${config.transitUrl ? `\n  transit:     ${config.transitUrl}` : ""}`);
  console.log(`  wallet:      ${config.walletConfigured ? "configured (live upstream payments)" : "not set (fixture fallback)"}`);
  if (usingDevSecret()) {
    console.log("  WARNING: using built-in dev SIGNING_SECRET — set SIGNING_SECRET in production.");
  }
  console.log("  Paid routes:");
  for (const [route, price] of Object.entries(PRICES)) {
    console.log(`    ${route.padEnd(26)} ${price} (+ upstream passthrough)`);
  }
  console.log("  Free routes: GET /config, POST /verify, GET /healthz, GET /.well-known/x402");
});
