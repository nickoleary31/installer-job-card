import { isNativeRuntime } from "./runtime.ts";

/**
 * Boundary interface only (Phase 1A). Generic key/value secure storage.
 * NOT used for the Supabase session today — the Supabase SDK manages its own
 * session storage independently. This exists for future native-secret needs
 * (e.g. a device-bound token) that should not go through plain localStorage.
 */
export interface SecureStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

/** NOT actually secure — plain localStorage. Fine as a Phase 1A web stand-in only. */
class WebLocalStorageFallback implements SecureStorage {
  async get(key: string): Promise<string | null> {
    return window.localStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    window.localStorage.setItem(key, value);
  }
  async remove(key: string): Promise<void> {
    window.localStorage.removeItem(key);
  }
}

/**
 * @aparajita/capacitor-secure-storage is genuinely OS-backed (iOS Keychain,
 * Android Keystore-backed AES-GCM) — see its README. We use only its "low
 * level" string methods (getItem/setItem/removeItem), which mirror this
 * file's plain-string SecureStorage interface exactly and skip its own
 * JSON/Date convenience layer (get/set) that this boundary doesn't need.
 * Dynamically imported inside each method — same pattern as the other three
 * new native packages, so this file stays safe to import from the root
 * Next build, SSR, or the plain-browser web app.
 */
class NativeCapacitorSecureStorage implements SecureStorage {
  async get(key: string): Promise<string | null> {
    const { SecureStorage: plugin } = await import("@aparajita/capacitor-secure-storage");
    return plugin.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    const { SecureStorage: plugin } = await import("@aparajita/capacitor-secure-storage");
    await plugin.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    const { SecureStorage: plugin } = await import("@aparajita/capacitor-secure-storage");
    await plugin.removeItem(key);
  }
}

export function getSecureStorage(): SecureStorage {
  return isNativeRuntime() ? new NativeCapacitorSecureStorage() : new WebLocalStorageFallback();
}
