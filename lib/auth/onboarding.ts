export const ACCEPT_INVITE_PATH = "/auth/accept-invite";
export const LOGIN_PATH = "/login";
export const HOME_PATH = "/home";
export const PRODUCTION_APP_ORIGIN = "https://install.tkptelematics.com";
export const PRODUCTION_ACCEPT_INVITE_URL = new URL(
  ACCEPT_INVITE_PATH,
  `${PRODUCTION_APP_ORIGIN}/`,
).toString();

export type ResolveOriginOptions = {
  nodeEnv?: string;
  appUrl?: string;
};

/** Authenticated users with incomplete onboarding may only stay on this path. */
export function isOnboardingExemptPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === ACCEPT_INVITE_PATH;
}

export function isOnboardingComplete(onboardingCompletedAt: string | null | undefined): boolean {
  return Boolean(onboardingCompletedAt?.trim());
}

/**
 * Gate decision: incomplete authenticated users must be sent to accept-invite,
 * except when already there (prevents redirect loops).
 */
export function shouldForceOnboardingRedirect(args: {
  loading: boolean;
  userId: string | null | undefined;
  onboardingCompleted: boolean;
  pathname: string | null | undefined;
}): boolean {
  if (args.loading) return false;
  if (!args.userId) return false;
  if (args.onboardingCompleted) return false;
  if (isOnboardingExemptPath(args.pathname)) return false;
  return true;
}

/** Completed users who open accept-invite should leave for the app (no loop). */
export function shouldLeaveAcceptInviteForApp(args: {
  loading: boolean;
  userId: string | null | undefined;
  onboardingCompleted: boolean;
  pathname: string | null | undefined;
}): boolean {
  if (args.loading) return false;
  if (!args.userId) return false;
  if (!args.onboardingCompleted) return false;
  return args.pathname === ACCEPT_INVITE_PATH;
}

export function resolvePostLoginPath(onboardingCompleted: boolean): string {
  return onboardingCompleted ? HOME_PATH : ACCEPT_INVITE_PATH;
}

export function passwordsMatch(password: string, confirmPassword: string): boolean {
  return password.length > 0 && password === confirmPassword;
}

export function isPasswordStrongEnough(password: string): boolean {
  return password.trim().length >= 8;
}

export function isFullNameValid(fullName: string): boolean {
  return fullName.trim().length >= 2;
}

/** Require at least 7 digits after stripping formatting characters. */
export function isPhoneValid(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
}

export type OnboardingFormInput = {
  fullName: string;
  phone: string;
  jobTitle?: string;
  password: string;
  confirmPassword: string;
};

export type OnboardingFormErrors = {
  fullName?: string;
  phone?: string;
  password?: string;
  confirmPassword?: string;
  form?: string;
};

export function validateOnboardingForm(input: OnboardingFormInput): OnboardingFormErrors {
  const errors: OnboardingFormErrors = {};
  if (!isFullNameValid(input.fullName)) {
    errors.fullName = "Full name is required.";
  }
  if (!input.phone.trim()) {
    errors.phone = "Phone number is required.";
  } else if (!isPhoneValid(input.phone)) {
    errors.phone = "Enter a valid phone number (at least 7 digits).";
  }
  if (!input.password) {
    errors.password = "Password is required.";
  } else if (!isPasswordStrongEnough(input.password)) {
    errors.password = "Password must be at least 8 characters.";
  }
  if (!input.confirmPassword) {
    errors.confirmPassword = "Confirm your password.";
  } else if (!passwordsMatch(input.password, input.confirmPassword)) {
    errors.confirmPassword = "Passwords do not match.";
  }
  return errors;
}

export function hasOnboardingFormErrors(errors: OnboardingFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Profile columns the invitee may set during onboarding.
 * Never includes global_role, is_active, or membership/assignment fields.
 */
export function buildOnboardingProfileUpdate(args: {
  fullName: string;
  phone: string;
  jobTitle?: string;
  email: string | null;
  completedAt?: string;
}): {
  display_name: string;
  phone: string;
  job_title: string | null;
  email: string | null;
  onboarding_completed_at: string;
  updated_at: string;
} {
  const completedAt = args.completedAt || new Date().toISOString();
  const jobTitle = args.jobTitle?.trim() || "";
  return {
    display_name: args.fullName.trim(),
    phone: args.phone.trim(),
    job_title: jobTitle || null,
    email: args.email?.trim().toLowerCase() || null,
    onboarding_completed_at: completedAt,
    updated_at: completedAt,
  };
}

export function onboardingProfileUpdateTouchesProtectedFields(
  patch: Record<string, unknown>,
): boolean {
  const protectedKeys = [
    "id",
    "global_role",
    "is_active",
    "role",
    "company_id",
    "user_id",
    "project_id",
  ];
  return protectedKeys.some((key) => Object.prototype.hasOwnProperty.call(patch, key));
}

/** Password must succeed before profile completion is attempted. */
export type OnboardingWriteStep = "password" | "profile";

export function nextOnboardingWriteStep(passwordCreated: boolean): OnboardingWriteStep {
  return passwordCreated ? "profile" : "password";
}

/**
 * Simulates migration backfill: every existing profile with null completion
 * becomes complete so current users are not blocked.
 */
export function applyOnboardingBackfill<T extends { onboarding_completed_at: string | null }>(
  profiles: T[],
  fallbackIso: string,
): Array<T & { onboarding_completed_at: string }> {
  return profiles.map((row) => ({
    ...row,
    onboarding_completed_at: row.onboarding_completed_at?.trim() || fallbackIso,
  }));
}

function isPrivateLanHostname(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1") return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isProductionAppHostname(hostname: string): boolean {
  return hostname.toLowerCase() === new URL(PRODUCTION_APP_ORIGIN).hostname;
}

/**
 * Origins allowed to control invite redirectTo.
 * Production never trusts localhost/LAN. Development may use local/LAN origins.
 */
export function isTrustedInviteOrigin(
  origin: string,
  options: { isProd: boolean } = { isProd: process.env.NODE_ENV === "production" },
): boolean {
  try {
    const parsed = new URL(origin);
    const host = parsed.hostname.toLowerCase();
    if (isProductionAppHostname(host)) return true;
    if (options.isProd) return false;
    return isPrivateLanHostname(host);
  } catch {
    return false;
  }
}

function candidateOriginFromRequest(req?: Request): string | null {
  if (!req) return null;

  const originHeader = req.headers.get("origin")?.trim() || "";
  if (originHeader) {
    try {
      return new URL(originHeader).origin;
    } catch {
      // fall through
    }
  }

  const forwardedHost = req.headers.get("x-forwarded-host")?.trim() || "";
  const forwardedProto = req.headers.get("x-forwarded-proto")?.trim() || "https";
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost.split(",")[0]!.trim()}`;
  }

  const host = req.headers.get("host")?.trim() || "";
  if (host) {
    const hostname = host.split(":")[0] || host;
    const proto = isPrivateLanHostname(hostname) ? "http" : "https";
    return `${proto}://${host}`;
  }

  return null;
}

function configuredPublicOrigin(appUrl: string): string | null {
  const raw = appUrl.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.toLowerCase();
    if (isPrivateLanHostname(host) || host.endsWith(".vercel.app")) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve a trusted browser origin for invite emails.
 * Never lets production fall back to localhost.
 */
export function resolveTrustedRequestOrigin(
  req?: Request,
  options: ResolveOriginOptions = {},
): string {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const appUrl = options.appUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "";

  const fromRequest = candidateOriginFromRequest(req);
  if (fromRequest && isTrustedInviteOrigin(fromRequest, { isProd })) {
    return fromRequest;
  }

  const fromConfig = configuredPublicOrigin(appUrl);
  if (fromConfig && isTrustedInviteOrigin(fromConfig, { isProd: true })) {
    return fromConfig;
  }

  return PRODUCTION_APP_ORIGIN;
}

/**
 * Exact invite redirectTo passed to inviteUserByEmail.
 * Always appends /auth/accept-invite via the URL constructor (never origin-only).
 */
export function resolveAcceptInviteRedirectTo(
  req?: Request,
  options: ResolveOriginOptions = {},
): string {
  const origin = resolveTrustedRequestOrigin(req, options);
  return new URL(ACCEPT_INVITE_PATH, `${origin}/`).toString();
}

/**
 * Detect Supabase invite / email auth callback params on the current page URL.
 * Used to forward misplaced callbacks (e.g. Site URL "/") to /auth/accept-invite
 * and to suppress premature /login redirects while tokens are still being processed.
 */
export function urlLooksLikeInviteAuthCallback(href: string): boolean {
  try {
    const url = new URL(href);
    const hashParams = new URLSearchParams(url.hash.startsWith("#") ? url.hash.slice(1) : "");
    const type = (url.searchParams.get("type") || hashParams.get("type") || "").toLowerCase();
    if (type === "invite") return true;
    if (url.searchParams.has("token_hash")) return true;
    if (hashParams.has("token_hash")) return true;
    if (hashParams.has("access_token") && type === "invite") return true;
    // PKCE invite often lands on Site URL as /?code=... without type.
    if (url.searchParams.has("code")) {
      const path = url.pathname || "/";
      return path === "/" || path === LOGIN_PATH || path === HOME_PATH;
    }
    return false;
  } catch {
    return false;
  }
}

/** Preserve query + hash when moving an invite callback onto the accept-invite route. */
export function buildAcceptInviteCallbackHref(href: string): string {
  const url = new URL(href);
  return `${ACCEPT_INVITE_PATH}${url.search}${url.hash}`;
}

/**
 * Exact redirect URLs that must be allow-listed in Supabase Auth → URL Configuration.
 * Add any LAN origins you use for device testing.
 */
export function requiredSupabaseAuthRedirectUrls(extraLanOrigins: string[] = []): string[] {
  const urls = [
    PRODUCTION_ACCEPT_INVITE_URL,
    new URL(ACCEPT_INVITE_PATH, "http://localhost:3000/").toString(),
    new URL(ACCEPT_INVITE_PATH, "http://127.0.0.1:3000/").toString(),
  ];
  for (const raw of extraLanOrigins) {
    try {
      const origin = new URL(raw).origin;
      urls.push(new URL(ACCEPT_INVITE_PATH, `${origin}/`).toString());
    } catch {
      // ignore invalid extras
    }
  }
  return [...new Set(urls)];
}

export function describeInvalidInviteSessionMessage(): string {
  return "This invite link is invalid or has expired. Open the latest invite from your email, or sign in if you already created a password.";
}
