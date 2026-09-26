import { isValidRole, type CompanyRole } from "./admin-api.ts";

/**
 * POST /api/company-users/add-existing. Adds (or reactivates) an existing
 * Installer Sheetz user in ONE company, the company the requester was just
 * authorized to manage. The membership row is always written for that
 * authorized company id, so a crafted body can't touch another company.
 * The target user may be any directory user (Q7), including one whose
 * profile is inactive: the row is created, but the user gets no access until
 * reactivated, because every access check refuses inactive profiles.
 *
 * Response contract unchanged (the web callers read ok/alreadyActive/message/
 * error). Pure given `deps` (company-user-routes.test.ts). The route wires the
 * service-role client only after authorizeCompanyUserManager has succeeded
 * (fail closed without the key).
 */

export type AddExistingProfile = {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
};

export type AddExistingMembership = { user_id: string; role: CompanyRole; is_active: boolean };

export type AddExistingAuth = { ok: true; requesterUserId: string } | { ok: false; status: number; error: string };

export interface AddExistingDeps {
  authorize(args: { accessToken: string; companyId: string }): Promise<AddExistingAuth>;
  loadProfile(userId: string): Promise<{ profile: AddExistingProfile | null; error: string | null }>;
  loadMembership(companyId: string, userId: string): Promise<{ membership: AddExistingMembership | null; error: string | null }>;
  upsertMembership(row: { companyId: string; userId: string; role: CompanyRole; updatedAt: string }): Promise<{ error: string | null }>;
}

export type AddExistingResult = { status: number; body: Record<string, unknown> };

export async function handleAddExistingUser(
  input: { accessToken: string; companyId: string; userId: string; role: string },
  deps: AddExistingDeps,
  now: () => Date = () => new Date(),
): Promise<AddExistingResult> {
  const companyId = input.companyId.trim();
  const userId = input.userId.trim();
  const role = input.role.trim();

  if (!userId) {
    return { status: 400, body: { error: "User is required." } };
  }
  if (!isValidRole(role)) {
    return { status: 400, body: { error: "Role must be admin or technician." } };
  }

  const auth = await deps.authorize({ accessToken: input.accessToken, companyId });
  if (!auth.ok) {
    return { status: auth.status, body: { error: auth.error } };
  }

  const { profile, error: profileError } = await deps.loadProfile(userId);
  if (profileError) {
    return { status: 500, body: { error: profileError } };
  }
  if (!profile) {
    return { status: 404, body: { error: "User profile not found." } };
  }

  const { membership: existing, error: membershipLookupError } = await deps.loadMembership(companyId, userId);
  if (membershipLookupError) {
    return { status: 500, body: { error: membershipLookupError } };
  }

  const displayName = profile.display_name?.trim() || profile.email?.trim() || userId;
  const email = profile.email?.trim() || "";

  if (existing?.is_active) {
    return {
      status: 200,
      body: {
        ok: true,
        userId,
        alreadyActive: true,
        reactivated: false,
        created: false,
        displayName,
        email,
        message: "This user is already an active member of this company.",
      },
    };
  }

  const { error: upsertError } = await deps.upsertMembership({
    companyId,
    userId,
    role,
    updatedAt: now().toISOString(),
  });
  if (upsertError) {
    return { status: 500, body: { error: upsertError } };
  }

  const reactivated = !!existing && !existing.is_active;
  return {
    status: 200,
    body: {
      ok: true,
      userId,
      alreadyActive: false,
      reactivated,
      created: !existing,
      displayName,
      email,
      message: reactivated ? "Existing membership reactivated for this company." : "Existing user added to this company.",
    },
  };
}
