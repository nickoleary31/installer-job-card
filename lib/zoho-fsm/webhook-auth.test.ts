import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isValidWebhookSecret } from "./webhook-auth.ts";

describe("zoho-fsm webhook auth", () => {
  it("rejects a missing secret", () => {
    assert.equal(isValidWebhookSecret(null, "correct-secret"), false);
    assert.equal(isValidWebhookSecret(undefined, "correct-secret"), false);
    assert.equal(isValidWebhookSecret("", "correct-secret"), false);
  });

  it("rejects a wrong secret", () => {
    assert.equal(isValidWebhookSecret("wrong-secret", "correct-secret"), false);
  });

  it("rejects a secret of different length without throwing", () => {
    assert.equal(isValidWebhookSecret("short", "a-much-longer-correct-secret"), false);
  });

  it("rejects when no secret is configured server-side", () => {
    assert.equal(isValidWebhookSecret("anything", ""), false);
  });

  it("accepts the correct secret", () => {
    assert.equal(isValidWebhookSecret("correct-secret", "correct-secret"), true);
  });

  it("tolerates incidental whitespace around the configured/provided secret", () => {
    assert.equal(isValidWebhookSecret(" correct-secret ", "correct-secret"), true);
  });
});
