import { randomBytes } from "node:crypto";
import { sign, type SignedArtifact } from "./sign.js";
import {
  callUpstream,
  fixtureDinner,
  fixtureGift,
  fixtureHotel,
  fixtureTransit,
  upstreamConfig,
  type StepResult,
} from "./upstream.js";

export type TaskType = "dinner" | "hotel" | "gift" | "transit";

export interface PlanTask {
  type: TaskType;
  [key: string]: unknown;
}

export interface PlanRequest {
  tasks: PlanTask[];
  budgetUsd?: number;
}

const SANDBOX_ROUTES: Record<Exclude<TaskType, "transit">, { path: string; method: "POST" }> = {
  dinner: { path: "/restaurant/book", method: "POST" },
  hotel: { path: "/hotel/book", method: "POST" },
  gift: { path: "/store/buy", method: "POST" },
};

const FIXTURES: Record<TaskType, (task: Record<string, unknown>) => unknown> = {
  dinner: fixtureDinner,
  hotel: fixtureHotel,
  gift: fixtureGift,
  transit: fixtureTransit,
};

export function validatePlanRequest(body: unknown): { error?: string; request?: PlanRequest } {
  const req = body as PlanRequest;
  if (!req || !Array.isArray(req.tasks) || req.tasks.length === 0) {
    return { error: "body must be {tasks: [{type: dinner|hotel|gift|transit, …}, …]}" };
  }
  if (req.tasks.length > 8) {
    return { error: "at most 8 tasks per plan" };
  }
  for (const task of req.tasks) {
    if (!task || typeof task.type !== "string" || !(task.type in FIXTURES)) {
      return { error: `unsupported task type: ${JSON.stringify(task?.type)} (supported: dinner, hotel, gift, transit)` };
    }
  }
  return { request: req };
}

async function runTask(task: PlanTask): Promise<StepResult> {
  const config = upstreamConfig();
  const fixture = FIXTURES[task.type];

  if (task.type === "transit") {
    if (config.transitUrl) {
      const params = new URLSearchParams({
        from: String(task.from ?? ""),
        to: String(task.to ?? ""),
      });
      const url = `${config.transitUrl}/plan?${params}`;
      const outcome = await callUpstream(url);
      if (outcome.ok) {
        return {
          task: task.type,
          upstream: url,
          mode: "live",
          artifact: outcome.body,
          paymentReceipt: outcome.paymentReceipt ?? null,
        };
      }
      return {
        task: task.type,
        upstream: url,
        mode: "fixture",
        artifact: fixture(task),
        paymentReceipt: null,
        quotedRequirements: outcome.quotedRequirements,
        note: outcome.note,
      };
    }
    return {
      task: task.type,
      upstream: null,
      mode: "fixture",
      artifact: fixture(task),
      paymentReceipt: null,
      note: "TRANSIT_URL not configured — returned a deterministic sample itinerary.",
    };
  }

  const route = SANDBOX_ROUTES[task.type];
  const url = `${config.sandboxUrl}${route.path}`;
  const outcome = await callUpstream(url, {
    method: route.method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(task),
  });
  if (outcome.ok) {
    return {
      task: task.type,
      upstream: url,
      mode: "live",
      artifact: outcome.body,
      paymentReceipt: outcome.paymentReceipt ?? null,
    };
  }
  return {
    task: task.type,
    upstream: url,
    mode: "fixture",
    artifact: fixture(task),
    paymentReceipt: null,
    quotedRequirements: outcome.quotedRequirements,
    note: outcome.note,
  };
}

export interface ComposedPlan {
  planId: string;
  requested: PlanTask[];
  steps: StepResult[];
  summary: {
    tasks: number;
    live: number;
    fixture: number;
    upstreamSandbox: string;
    walletConfigured: boolean;
  };
  createdAt: string;
}

/** Execute every task (sequentially — receipts stay ordered) and sign the composed itinerary. */
export async function composePlan(request: PlanRequest): Promise<SignedArtifact<ComposedPlan>> {
  const config = upstreamConfig();
  const steps: StepResult[] = [];
  for (const task of request.tasks) {
    steps.push(await runTask(task));
  }
  const plan: ComposedPlan = {
    planId: `plan_${randomBytes(8).toString("hex")}`,
    requested: request.tasks,
    steps,
    summary: {
      tasks: steps.length,
      live: steps.filter((s) => s.mode === "live").length,
      fixture: steps.filter((s) => s.mode === "fixture").length,
      upstreamSandbox: config.sandboxUrl,
      walletConfigured: config.walletConfigured,
    },
    createdAt: new Date().toISOString(),
  };
  return sign(plan);
}
