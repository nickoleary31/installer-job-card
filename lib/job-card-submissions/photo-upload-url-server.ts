import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeProjectAccess } from "../project-access.ts";
import { requirePrivilegedServiceClient, type SupabaseServerEnv } from "../company-users/admin-api.ts";
import type { PhotoStorageRepo, PhotoUploadAccess } from "./photo-upload-url.ts";

const PHOTO_BUCKET = "job-card-photos";

/**
 * Real Supabase Storage implementation. `{ upsert: true }` here — not on
 * the later upload call, which the installed storage-js SDK's own doc
 * confirms has no effect there (verified against
 * node_modules/@supabase/storage-js source before relying on it) — is
 * what makes a retried upload to the SAME localPhotoId overwrite in place
 * rather than fail or create a duplicate object.
 */
export function createSupabasePhotoStorageRepo(dataClient: SupabaseClient): PhotoStorageRepo {
  return {
    async createSignedUploadUrl(path: string) {
      const { data, error } = await dataClient.storage.from(PHOTO_BUCKET).createSignedUploadUrl(path, { upsert: true });
      if (error || !data) return { error: error?.message || "Could not create a signed upload URL." };
      return { path: data.path, token: data.token };
    },
  };
}

export function createPhotoUploadAccess(env: SupabaseServerEnv): PhotoUploadAccess {
  return {
    async authorize(args) {
      // Phase 2H security reconciliation — fail closed before issuing a
      // signed upload URL if no privileged key is configured. See
      // requirePrivilegedServiceClient's own doc.
      const privileged = requirePrivilegedServiceClient(env);
      if (!privileged.ok) return privileged;
      const auth = await authorizeProjectAccess({ env, ...args });
      if (!auth.ok) return auth;
      return { ok: true, storage: createSupabasePhotoStorageRepo(auth.dataClient) };
    },
  };
}
