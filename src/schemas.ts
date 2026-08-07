// GENERATED from openapi.json — do not edit by hand.
//
// Per-route invocation contracts published inside the x402 402 challenge as
// `accepts[].outputSchema`. `input` tells an agent how to build the request
// (method, query/path params, JSON body fields); `output` is the JSON Schema of
// the 200 body it gets back once payment settles.
//
// Deriving these from `openapi.json` keeps the runtime challenge — which the
// x402scan discovery spec treats as authoritative — from ever contradicting the
// published spec. Regenerate whenever a paid route's parameters or response
// schema change.
//
// Keys match the paywall route map in `server.ts` exactly (`"<METHOD> <path>"`,
// with `:param` for path segments).

import type { RouteSchema } from "./payments.js";

export const ROUTE_SCHEMAS: Record<string, RouteSchema> = {
  "POST /plan": {
    "input": {
      "type": "http",
      "method": "POST",
      "bodyType": "json",
      "bodyFields": {
        "tasks": {
          "type": "array",
          "minItems": 1,
          "maxItems": 8,
          "items": {
            "type": "object",
            "required": [
              "type"
            ],
            "properties": {
              "type": {
                "type": "string",
                "enum": [
                  "dinner",
                  "hotel",
                  "gift",
                  "transit"
                ]
              }
            },
            "additionalProperties": true
          },
          "x-required": true
        }
      }
    },
    "output": {
      "type": "object",
      "properties": {
        "plan": {
          "type": "object",
          "properties": {
            "payload": {
              "type": "object",
              "properties": {
                "planId": {
                  "type": "string"
                },
                "requested": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "required": [
                      "type"
                    ],
                    "properties": {
                      "type": {
                        "type": "string",
                        "enum": [
                          "dinner",
                          "hotel",
                          "gift",
                          "transit"
                        ]
                      }
                    },
                    "additionalProperties": true
                  }
                },
                "steps": {
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "task": {
                        "type": "string"
                      },
                      "upstream": {
                        "type": [
                          "string",
                          "null"
                        ]
                      },
                      "mode": {
                        "type": "string",
                        "enum": [
                          "live",
                          "fixture"
                        ]
                      },
                      "artifact": {},
                      "paymentReceipt": {},
                      "quotedRequirements": {},
                      "note": {
                        "type": "string"
                      }
                    }
                  }
                },
                "summary": {
                  "type": "object",
                  "properties": {
                    "tasks": {
                      "type": "integer"
                    },
                    "live": {
                      "type": "integer"
                    },
                    "fixture": {
                      "type": "integer"
                    },
                    "upstreamSandbox": {
                      "type": "string"
                    },
                    "walletConfigured": {
                      "type": "boolean"
                    }
                  }
                },
                "createdAt": {
                  "type": "string"
                }
              }
            },
            "signature": {
              "type": "string"
            },
            "algorithm": {
              "type": "string",
              "const": "HMAC-SHA256"
            },
            "canonicalization": {
              "type": "string",
              "const": "sorted-json"
            }
          }
        }
      }
    }
  },
};
