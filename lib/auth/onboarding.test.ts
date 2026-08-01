import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACCEPT_INVITE_PATH,
  HOME_PATH,
  PRODUCTION_ACCEPT_INVITE_URL,
  applyOnboardingBackfill,
  buildAcceptInviteCallbackHref,
  buildOnboardingProfileUpdate,
  describeInvalidInviteSessionMessage,
  hasOnboardingFormErrors,
  isFullNameValid,
  isOnboardingComplete,
  isOnboardingExemptPath,
  isPasswordStrongEnough,
  isPhoneValid,
  isTrustedInviteOrigin,
  nextOnboardingWriteStep,
  onboardingProfileUpdateTouchesProtectedFields,
  passwordsMatch,
  requiredSupabaseAuthRedirectUrls,
  resolveAcceptInviteRedirectTo,
  resolvePostLoginPath,
  resolveTrustedRequestOrigin,
  shouldForceOnboardingRedirect,
  shouldLeaveAcceptInviteForApp,
  urlLooksLikeInviteAuthCallback,
  validateOnboardingForm,
} from "./onboarding.ts";

describe("invite onboarding — session routing", () => {
  it("only exempts the accept-invite path", () => {
    assert.equal(isOnboardingExemptPath(ACCEPT_INVITE_PATH), true);
    assert.equal(isOnboardingExemptPath("/home"), false);
    assert.equal(isOnboardingExemptPath("/login"), false);
  });

  it("incomplete user cannot bypass onboarding", () => {
    assert.equal(
      shouldForceOnboardingRedirect({
        loading: false,
        userId: "user-1",
        onboardingCompleted: false,
        pathname: "/home",
      }),
      true,
    );
  });

  it("completed user can access the app", () => {
    assert.equal(
      shouldForceOnboardingRedirect({
        loading: false,
        userId: "user-1",
        onboardingCompleted: true,
        pathname: "/home",
      }),
      false,
    );
    assert.equal(resolvePostLoginPath(true), HOME_PATH);
  });

  it("login redirects incomplete users to onboarding and complete users to home", () => {
    assert.equal(resolvePostLoginPath(false), ACCEPT_INVITE_PATH);
    assert.equal(resolvePostLoginPath(true), HOME_PATH);
  });

  it("prevents redirect loops between gate and accept-invite", () => {
    assert.equal(
      shouldForceOnboardingRedirect({
        loading: false,
        userId: "user-1",
        onboardingCompleted: false,
        pathname: ACCEPT_INVITE_PATH,
      }),
      false,
    );
    assert.equal(
      shouldLeaveAcceptInviteForApp({
        loading: false,
        userId: "user-1",
        onboardingCompleted: true,
        pathname: ACCEPT_INVITE_PATH,
      }),
      true,
    );
  });

  it("expired/invalid invite has a clear message", () => {
    const message = describeInvalidInviteSessionMessage();
    assert.match(message, /invalid|expired/i);
    assert.doesNotMatch(message, /access_token|refresh_token|bearer/i);
  });
});

describe("invite onboarding — form validation", () => {
  it("full name is required", () => {
    assert.equal(isFullNameValid(""), false);
    assert.equal(isFullNameValid("Ada Lovelace"), true);
    const errors = validateOnboardingForm({
      fullName: " ",
      phone: "555-123-4567",
      password: "password1",
      confirmPassword: "password1",
    });
    assert.equal(errors.fullName, "Full name is required.");
  });

  it("phone validation requires enough digits", () => {
    assert.equal(isPhoneValid("555-1234"), true);
    const errors = validateOnboardingForm({
      fullName: "Ada Lovelace",
      phone: "12",
      password: "password1",
      confirmPassword: "password1",
    });
    assert.match(errors.phone || "", /valid phone/i);
  });

  it("password and confirmation must match", () => {
    assert.equal(passwordsMatch("password1", "password2"), false);
    const errors = validateOnboardingForm({
      fullName: "Ada Lovelace",
      phone: "555-123-4567",
      password: "password1",
      confirmPassword: "password2",
    });
    assert.equal(errors.confirmPassword, "Passwords do not match.");
  });

  it("password is mandatory and must be strong enough", () => {
    assert.equal(isPasswordStrongEnough("short"), false);
    const missing = validateOnboardingForm({
      fullName: "Ada Lovelace",
      phone: "555-123-4567",
      password: "",
      confirmPassword: "",
    });
    assert.equal(missing.password, "Password is required.");
    assert.ok(hasOnboardingFormErrors(missing));
  });
});

describe("invite onboarding — password then profile", () => {
  it("password must be created before profile completion", () => {
    assert.equal(nextOnboardingWriteStep(false), "password");
    assert.equal(nextOnboardingWriteStep(true), "profile");
  });

  it("profile fields saved exclude membership and role elevation", () => {
    const patch = buildOnboardingProfileUpdate({
      fullName: "Ada Lovelace",
      phone: "555-123-4567",
      jobTitle: "Technician",
      email: "ada@example.com",
      completedAt: "2026-08-01T12:00:00.000Z",
    });
    assert.equal(onboardingProfileUpdateTouchesProtectedFields(patch), false);
    assert.equal(onboardingProfileUpdateTouchesProtectedFields({ ...patch, global_role: "admin" }), true);
  });
});

describe("invite onboarding — redirectTo full path", () => {
  it("production request includes /auth/accept-invite", () => {
    const req = new Request("https://install.tkptelematics.com/api/company-users/invite", {
      headers: { origin: "https://install.tkptelematics.com" },
    });
    const redirectTo = resolveAcceptInviteRedirectTo(req, { nodeEnv: "production" });
    assert.equal(redirectTo, PRODUCTION_ACCEPT_INVITE_URL);
    assert.equal(new URL(redirectTo).pathname, ACCEPT_INVITE_PATH);
  });

  it("localhost request includes /auth/accept-invite", () => {
    const req = new Request("http://localhost:3000/api/company-users/invite", {
      headers: { origin: "http://localhost:3000" },
    });
    const redirectTo = resolveAcceptInviteRedirectTo(req, { nodeEnv: "development" });
    assert.equal(redirectTo, "http://localhost:3000/auth/accept-invite");
    assert.equal(new URL(redirectTo).pathname, ACCEPT_INVITE_PATH);
  });

  it("LAN request includes /auth/accept-invite", () => {
    const req = new Request("http://192.168.1.162:3000/api/company-users/invite", {
      headers: { origin: "http://192.168.1.162:3000" },
    });
    const redirectTo = resolveAcceptInviteRedirectTo(req, { nodeEnv: "development" });
    assert.equal(redirectTo, "http://192.168.1.162:3000/auth/accept-invite");
    assert.equal(new URL(redirectTo).pathname, ACCEPT_INVITE_PATH);
  });

  it("malicious/unapproved host cannot control redirectTo in production", () => {
    const req = new Request("https://evil.example/api/company-users/invite", {
      headers: { origin: "https://evil.example" },
    });
    const redirectTo = resolveAcceptInviteRedirectTo(req, {
      nodeEnv: "production",
      appUrl: "https://install.tkptelematics.com",
    });
    assert.equal(redirectTo, PRODUCTION_ACCEPT_INVITE_URL);
    assert.equal(isTrustedInviteOrigin("https://evil.example", { isProd: true }), false);
  });

  it("production never generates localhost", () => {
    const req = new Request("https://install.tkptelematics.com/api/company-users/invite", {
      headers: { origin: "http://localhost:3000" },
    });
    const redirectTo = resolveAcceptInviteRedirectTo(req, {
      nodeEnv: "production",
      appUrl: "https://install.tkptelematics.com",
    });
    assert.equal(redirectTo, PRODUCTION_ACCEPT_INVITE_URL);
    assert.doesNotMatch(redirectTo, /localhost|127\.0\.0\.1|192\.168\./i);
  });

  it("falls back to production when no trusted request origin is available", () => {
    assert.equal(resolveTrustedRequestOrigin(undefined, { nodeEnv: "production" }), "https://install.tkptelematics.com");
    assert.equal(resolveAcceptInviteRedirectTo(), PRODUCTION_ACCEPT_INVITE_URL);
  });

  it("lists required Supabase Auth redirect URLs with full path", () => {
    const urls = requiredSupabaseAuthRedirectUrls(["http://192.168.1.162:3000"]);
    assert.ok(urls.every((u) => new URL(u).pathname === ACCEPT_INVITE_PATH));
    assert.ok(urls.includes(PRODUCTION_ACCEPT_INVITE_URL));
    assert.ok(urls.includes("http://192.168.1.162:3000/auth/accept-invite"));
  });
});

describe("invite onboarding — callback forwarding", () => {
  it("detects invite callback formats without needing token values", () => {
    assert.equal(
      urlLooksLikeInviteAuthCallback("http://localhost:3000/?code=REDACTED&type=invite"),
      true,
    );
    assert.equal(
      urlLooksLikeInviteAuthCallback("http://localhost:3000/?token_hash=REDACTED&type=invite"),
      true,
    );
    assert.equal(
      urlLooksLikeInviteAuthCallback("http://localhost:3000/#access_token=REDACTED&type=invite"),
      true,
    );
    assert.equal(urlLooksLikeInviteAuthCallback("http://localhost:3000/?code=REDACTED"), true);
    assert.equal(urlLooksLikeInviteAuthCallback("http://localhost:3000/home"), false);
  });

  it("builds accept-invite href preserving search and hash", () => {
    assert.equal(
      buildAcceptInviteCallbackHref("http://localhost:3000/?token_hash=REDACTED&type=invite"),
      "/auth/accept-invite?token_hash=REDACTED&type=invite",
    );
  });
});

describe("invite onboarding — migration backfill", () => {
  it("existing users remain complete after migration backfill", () => {
    const before = [
      { id: "a", onboarding_completed_at: null as string | null },
      { id: "b", onboarding_completed_at: "2026-01-01T00:00:00.000Z" as string | null },
    ];
    const after = applyOnboardingBackfill(before, "2026-08-01T00:00:00.000Z");
    assert.equal(after.every((row) => isOnboardingComplete(row.onboarding_completed_at)), true);
  });
});
