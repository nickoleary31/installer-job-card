import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getZohoFsmOrchestratorEnv } from "./orchestrator-env.ts";

function withEnv(overrides: Record<string, string | undefined>, run: () => void) {
  const originals: Record<string, string | undefined> = {};
  for (const key of Object.keys(overrides)) {
    originals[key] = process.env[key];
    if (overrides[key] === undefined) delete process.env[key];
    else process.env[key] = overrides[key];
  }
  try {
    run();
  } finally {
    for (const key of Object.keys(originals)) {
      if (originals[key] === undefined) delete process.env[key];
      else process.env[key] = originals[key];
    }
  }
}

describe("zoho-fsm orchestrator env", () => {
  it("reads both vars when set, trimmed", () => {
    withEnv(
      {
        ZOHO_FSM_ORCHESTRATOR_BASE_URL: "  https://zoho-fsm-orchestrator.vercel.app  ",
        ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN: "  secret-token  ",
      },
      () => {
        const env = getZohoFsmOrchestratorEnv();
        assert.equal(env.baseUrl, "https://zoho-fsm-orchestrator.vercel.app");
        assert.equal(env.adminToken, "secret-token");
        assert.deepEqual(env.missing, []);
      },
    );
  });

  it("reports both missing when unset — treated as auto-publish disabled, not an error", () => {
    withEnv(
      { ZOHO_FSM_ORCHESTRATOR_BASE_URL: undefined, ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN: undefined },
      () => {
        const env = getZohoFsmOrchestratorEnv();
        assert.equal(env.baseUrl, "");
        assert.equal(env.adminToken, "");
        assert.deepEqual(
          [...env.missing].sort(),
          ["ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN", "ZOHO_FSM_ORCHESTRATOR_BASE_URL"].sort(),
        );
      },
    );
  });

  it("reports only the missing one when only the base URL is set", () => {
    withEnv(
      {
        ZOHO_FSM_ORCHESTRATOR_BASE_URL: "https://zoho-fsm-orchestrator.vercel.app",
        ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN: undefined,
      },
      () => {
        const env = getZohoFsmOrchestratorEnv();
        assert.deepEqual(env.missing, ["ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN"]);
      },
    );
  });

  it("treats whitespace-only values as unset", () => {
    withEnv(
      { ZOHO_FSM_ORCHESTRATOR_BASE_URL: "   ", ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN: "   " },
      () => {
        const env = getZohoFsmOrchestratorEnv();
        assert.deepEqual(
          [...env.missing].sort(),
          ["ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN", "ZOHO_FSM_ORCHESTRATOR_BASE_URL"].sort(),
        );
      },
    );
  });
});
