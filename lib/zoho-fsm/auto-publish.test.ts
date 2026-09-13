import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";
import {
  handleAutoPublishRequest,
  triggerZohoPublishForProject,
  type AutoPublishAuthorizer,
  type ProjectAuthResult,
  type ZohoAutoPublishNotifier,
  type ZohoAutoPublishRepo,
} from "./auto-publish.ts";
import { createOrchestratorNotifier } from "./orchestrator-client.ts";

function fakeRepo(zohoServiceAppointmentId: string | null | Error): ZohoAutoPublishRepo & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async resolveServiceAppointmentId(projectId: string) {
      calls.push(projectId);
      if (zohoServiceAppointmentId instanceof Error) throw zohoServiceAppointmentId;
      return zohoServiceAppointmentId;
    },
  };
}

function fakeNotifier(
  outcome: { ok: boolean; status?: number } | Error,
): ZohoAutoPublishNotifier & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async publish(zohoServiceAppointmentId: string) {
      calls.push(zohoServiceAppointmentId);
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

describe("triggerZohoPublishForProject", () => {
  it("linked completion triggers correct SA", async () => {
    const repo = fakeRepo("SA-123");
    const notifier = fakeNotifier({ ok: true, status: 200 });

    const result = await triggerZohoPublishForProject("project-1", repo, notifier);

    assert.deepEqual(repo.calls, ["project-1"]);
    assert.deepEqual(notifier.calls, ["SA-123"]);
    assert.deepEqual(result, { outcome: "notified", zohoServiceAppointmentId: "SA-123" });
  });

  it("revision triggers again — calling it a second time for the same project notifies again, no de-dup/caching", async () => {
    const repo = fakeRepo("SA-123");
    const notifier = fakeNotifier({ ok: true, status: 200 });

    await triggerZohoPublishForProject("project-1", repo, notifier);
    const second = await triggerZohoPublishForProject("project-1", repo, notifier);

    assert.deepEqual(repo.calls, ["project-1", "project-1"]);
    assert.deepEqual(notifier.calls, ["SA-123", "SA-123"]);
    assert.equal(second.outcome, "notified");
  });

  it("unlinked project skips — no notification sent", async () => {
    const repo = fakeRepo(null);
    const notifier = fakeNotifier({ ok: true });

    const result = await triggerZohoPublishForProject("project-unlinked", repo, notifier);

    assert.deepEqual(result, { outcome: "unlinked" });
    assert.deepEqual(notifier.calls, []);
  });

  it("missing env (notifier disabled) skips safely without ever resolving the SA link", async () => {
    const repo = fakeRepo("SA-123");

    const result = await triggerZohoPublishForProject("project-1", repo, null);

    assert.deepEqual(result, { outcome: "disabled" });
    assert.deepEqual(repo.calls, [], "should never query for a link when auto-publish is disabled");
  });

  it("orchestrator success does not throw or otherwise disrupt the caller", async () => {
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: true, status: 200 });
    await assert.doesNotReject(() => triggerZohoPublishForProject("project-1", repo, notifier));
  });

  it("orchestrator non-2xx does not throw — resolves with notify_failed instead", async () => {
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: false, status: 500 });

    const result = await triggerZohoPublishForProject("project-1", repo, notifier);

    assert.deepEqual(result, { outcome: "notify_failed", zohoServiceAppointmentId: "SA-1" });
  });

  it("network exception from the notifier does not throw — resolves with notify_failed instead", async () => {
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier(new Error("fetch failed: ECONNREFUSED"));

    const result = await triggerZohoPublishForProject("project-1", repo, notifier);

    assert.deepEqual(result, { outcome: "notify_failed", zohoServiceAppointmentId: "SA-1" });
  });

  it("a repo failure resolving the SA link does not throw — resolves with notify_failed and never calls the notifier", async () => {
    const repo = fakeRepo(new Error("db unavailable"));
    const notifier = fakeNotifier({ ok: true });

    const result = await triggerZohoPublishForProject("project-1", repo, notifier);

    assert.deepEqual(result, { outcome: "notify_failed" });
    assert.deepEqual(notifier.calls, []);
  });
});

describe("createOrchestratorNotifier — token handling", () => {
  it("never includes the admin token in the resolved publish() result", async () => {
    const secretToken = "super-secret-admin-token-xyz";
    const original = {
      base: process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL,
      token: process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN,
    };
    process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL = "https://zoho-fsm-orchestrator.vercel.app";
    process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN = secretToken;

    const fetchMock = mock.method(globalThis, "fetch", async () => new Response("server error", { status: 500 }));
    const errorMock = mock.method(console, "error", () => {});
    const warnMock = mock.method(console, "warn", () => {});

    try {
      const notifier = createOrchestratorNotifier();
      assert.ok(notifier, "notifier should be configured");
      const result = await notifier!.publish("SA-999");

      // The result object handed back to the caller (and, transitively, to anything an API
      // route might ever log or return) must carry only ok/status — never the token.
      assert.deepEqual(result, { ok: false, status: 500 });
      assert.equal(JSON.stringify(result).includes(secretToken), false);

      // The outbound request itself does carry the token (that's how auth works) — but nothing
      // that gets logged should.
      const [, requestInit] = fetchMock.mock.calls[0].arguments as [string, RequestInit];
      const headers = requestInit.headers as Record<string, string>;
      assert.equal(headers.Authorization, `Bearer ${secretToken}`);

      const loggedText = [...errorMock.mock.calls, ...warnMock.mock.calls]
        .map((call) => call.arguments.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "))
        .join("\n");
      assert.equal(loggedText.includes(secretToken), false, "token must never appear in server logs");
    } finally {
      fetchMock.mock.restore();
      errorMock.mock.restore();
      warnMock.mock.restore();
      if (original.base === undefined) delete process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL;
      else process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL = original.base;
      if (original.token === undefined) delete process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN;
      else process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN = original.token;
    }
  });

  it("returns null (auto-publish disabled) when env is missing, without throwing", () => {
    const original = {
      base: process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL,
      token: process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN,
    };
    delete process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL;
    delete process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN;
    try {
      assert.equal(createOrchestratorNotifier(), null);
    } finally {
      if (original.base !== undefined) process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL = original.base;
      if (original.token !== undefined) process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN = original.token;
    }
  });
});

function fakeAuthorizer(result: ProjectAuthResult): AutoPublishAuthorizer & {
  calls: Array<{ accessToken: string; companyId: string; projectId: string }>;
} {
  const calls: Array<{ accessToken: string; companyId: string; projectId: string }> = [];
  return {
    calls,
    async authorize(args) {
      calls.push(args);
      return result;
    },
  };
}

describe("handleAutoPublishRequest — authorization gate", () => {
  const input = { accessToken: "user-token", companyId: "company-1", projectId: "project-1" };

  it("an unauthenticated call (no access token) is rejected — the authorizer itself enforces this, and no projectId alone bypasses it", async () => {
    const authorizer = fakeAuthorizer({ ok: false, status: 401, error: "Missing authorization token." });
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: true });

    const result = await handleAutoPublishRequest({ ...input, accessToken: "" }, authorizer, repo, notifier);

    assert.equal(result.status, 401);
    assert.deepEqual(result.body, { error: "Missing authorization token." });
    assert.equal("scheduleAfterWork" in result, false);
    assert.deepEqual(repo.calls, [], "repo must never be touched when the caller isn't even authenticated");
  });

  it("an authenticated user without project authorization is rejected", async () => {
    const authorizer = fakeAuthorizer({
      ok: false,
      status: 403,
      error: "Only global admins, active company admins, or technicians assigned to this project can access it.",
    });
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: true });

    const result = await handleAutoPublishRequest(input, authorizer, repo, notifier);

    assert.equal(result.status, 403);
    assert.equal("scheduleAfterWork" in result, false);
    assert.deepEqual(repo.calls, [], "an unauthorized caller must never trigger the privileged SA lookup");
    assert.deepEqual(notifier.calls, []);
  });

  it("an authenticated, authorized call is accepted (202) without the SA lookup/publish happening inline", async () => {
    const authorizer = fakeAuthorizer({ ok: true });
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: true });

    const result = await handleAutoPublishRequest(input, authorizer, repo, notifier);

    assert.deepEqual(authorizer.calls, [input]);
    assert.equal(result.status, 202);
    assert.deepEqual(result.body, { status: "accepted" });
    // The response is fully formed before any Zoho-reaching work has run.
    assert.deepEqual(repo.calls, []);
    assert.deepEqual(notifier.calls, []);
    assert.equal(typeof (result as { scheduleAfterWork?: unknown }).scheduleAfterWork, "function");
  });

  it("after()'s deferred work is responsible only for the downstream orchestrator call — invoking it is what triggers repo/notifier, not the authorized response itself", async () => {
    const authorizer = fakeAuthorizer({ ok: true });
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier({ ok: true });

    const result = await handleAutoPublishRequest(input, authorizer, repo, notifier);
    assert.equal("scheduleAfterWork" in result, true);
    if (!("scheduleAfterWork" in result)) return;

    assert.deepEqual(repo.calls, [], "must not have run yet — only the response was computed so far");
    const afterResult = await result.scheduleAfterWork();
    assert.deepEqual(repo.calls, ["project-1"]);
    assert.deepEqual(notifier.calls, ["SA-1"]);
    assert.equal(afterResult.outcome, "notified");
  });

  it("an orchestrator failure inside the deferred after() work does not change the already-computed accepted response", async () => {
    const authorizer = fakeAuthorizer({ ok: true });
    const repo = fakeRepo("SA-1");
    const notifier = fakeNotifier(new Error("orchestrator unreachable"));

    const result = await handleAutoPublishRequest(input, authorizer, repo, notifier);
    assert.equal(result.status, 202);
    assert.deepEqual(result.body, { status: "accepted" });
    if (!("scheduleAfterWork" in result)) throw new Error("expected an accepted result");

    // The 202 above was already produced; running the deferred work afterward — even when it
    // fails — cannot retroactively change it, and must not throw into whatever called after().
    await assert.doesNotReject(() => result.scheduleAfterWork());
    // Response is still the same object/value as before — nothing mutates it.
    assert.equal(result.status, 202);
    assert.deepEqual(result.body, { status: "accepted" });
  });

  it("no response body ever carries the orchestrator admin token, in either the authorized or rejected branch", async () => {
    // Use the REAL notifier (holding a REAL token in closure) rather than a fake one, so this
    // actually exercises the real risk surface: handleAutoPublishRequest's response construction
    // must never reach into the notifier for anything beyond scheduling it.
    const secretToken = "route-level-should-never-see-this-token";
    const original = {
      base: process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL,
      token: process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN,
    };
    process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL = "https://zoho-fsm-orchestrator.vercel.app";
    process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN = secretToken;
    try {
      const notifier = createOrchestratorNotifier();
      assert.ok(notifier);
      for (const authResult of [
        { ok: true as const },
        {
          ok: false as const,
          status: 403,
          error: "Only global admins, active company admins, or technicians assigned to this project can access it.",
        },
      ]) {
        const authorizer = fakeAuthorizer(authResult);
        const repo = fakeRepo("SA-1");
        const result = await handleAutoPublishRequest(input, authorizer, repo, notifier);
        assert.equal(JSON.stringify(result.body).includes(secretToken), false);
      }
    } finally {
      if (original.base === undefined) delete process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL;
      else process.env.ZOHO_FSM_ORCHESTRATOR_BASE_URL = original.base;
      if (original.token === undefined) delete process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN;
      else process.env.ZOHO_FSM_ORCHESTRATOR_ADMIN_TOKEN = original.token;
    }
  });
});
