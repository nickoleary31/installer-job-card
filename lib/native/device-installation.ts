import { getSecureStorage } from "./secure-storage.ts";

/**
 * A random identifier scoped to exactly this native app installation —
 * generated once and persisted through the same OS-backed secure storage
 * boundary used for the Phase 2C offline access lease (Android Keystore /
 * iOS Keychain, see secure-storage.ts). Survives force-close/restart and
 * app updates (Keystore/Keychain entries are tied to the app's package/
 * signing identity, not cleared by an update) without being derived from
 * any hardware identifier (serial/IMEI/MAC/etc) — deliberately not an
 * invasive device fingerprint, just a random value this specific install
 * happens to remember. See lib/auth/offline-access-lease.ts for why this
 * exists: binding a 7-day offline access lease to "this installation"
 * rather than trusting an unbound "we remember this user" record that
 * could otherwise be copied/replayed across devices.
 */
const STORAGE_KEY = "installer-sheetz-device-installation-id";

let cachedInstallationId: Promise<string> | null = null;

export async function getDeviceInstallationId(): Promise<string> {
  if (!cachedInstallationId) {
    cachedInstallationId = (async () => {
      const storage = getSecureStorage();
      const existing = await storage.get(STORAGE_KEY);
      if (existing) return existing;
      const generated = crypto.randomUUID();
      await storage.set(STORAGE_KEY, generated);
      return generated;
    })();
  }
  return cachedInstallationId;
}
