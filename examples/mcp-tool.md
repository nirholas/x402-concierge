# Expose x402-concierge as an MCP tool for Claude

[MCP](https://modelcontextprotocol.io) lets Claude call your services as tools. This implementation wraps `x402-fetch`, so every call pays its own way with USDC.

The service is **dual rail** — its 402 challenges accept USDC on Base *and* USDC on Solana. `x402-fetch` pays the Base rail; to pay from a Solana wallet instead, swap the fetch wrapper for an x402 Solana client (see [`docs/agents.md`](../docs/agents.md#solana-rail)). Everything below is otherwise identical.

## The server

```ts
// concierge-mcp.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";
import { z } from "zod";

const BASE = process.env.CONCIERGE_URL ?? "http://localhost:4042";
const payFetch = wrapFetchWithPayment(
  fetch,
  privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
);

const server = new McpServer({ name: "x402-concierge", version: "0.1.0" });

server.tool(
  "concierge_config",
  "Check which upstream services this concierge is wired to, and whether it can pay them live. Free — call before planning.",
  {},
  async () => {
    const res = await fetch(`${BASE}/config`);
    return { content: [{ type: "text", text: JSON.stringify(await res.json(), null, 2) }] };
  },
);

server.tool(
  "plan_errands",
  "Book dinner, buy a gift, plan transit and book a hotel in one paid call ($0.02 + upstream passthrough). Returns a signed itinerary with each step's artifact and payment receipt inline.",
  {
    tasks: z
      .array(
        z.object({
          type: z.enum(["dinner", "hotel", "gift", "transit"]),
          party: z.number().optional(),
          time: z.string().optional(),
          checkIn: z.string().optional(),
          nights: z.number().optional(),
          item: z.string().optional(),
          budgetUsd: z.number().optional(),
          from: z.string().optional(),
          to: z.string().optional(),
        }),
      )
      .min(1)
      .max(8),
  },
  async ({ tasks }) => {
    const res = await payFetch(`${BASE}/plan`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tasks }),
    });
    const body = await res.json();
    return { content: [{ type: "text", text: JSON.stringify(body, null, 2) }] };
  },
);

await server.connect(new StdioServerTransport());
```

```bash
npm install @modelcontextprotocol/sdk x402-fetch viem zod tsx
```

## Wire it into Claude Desktop

`claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "x402-concierge": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/concierge-mcp.ts"],
      "env": {
        "CONCIERGE_URL": "http://localhost:4042",
        "PRIVATE_KEY": "0x…wallet with Base Sepolia USDC…"
      }
    }
  }
}
```

Give the wallet a small, capped balance — every `plan_errands` call spends real (testnet) USDC, and the concierge may spend more upstream on your behalf. The tool result includes `conciergeFee.rail` and each step's `paymentReceipt`, so the agent can report exactly what it spent, with whom, and on which chain.

## Prompting notes

- Have the agent call `concierge_config` first. If `walletConfigured` is `false`, artifacts will be labeled `source: "fixture"` — useful for dry runs, not for real bookings.
- Ask the agent to surface `steps[].mode` in its summary so a human can tell a real reservation from a rehearsal.
- The signed `plan.payload` is worth storing: `POST /verify` re-checks it later without another payment.
