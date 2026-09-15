import { isNativeRuntime } from "./runtime";

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

/** Phase 1B/2: back this with @capacitor/preferences (or a Keychain/Keystore-backed plugin) for real secure storage. */
class NativeSecureStorageNotImplemented implements SecureStorage {
  get(): Promise<string | null> {
    throw new Error("Native secure storage is not implemented yet. Install and wire a secure-storage plugin in a later phase.");
  }
  set(): Promise<void> {
    throw new Error("Native secure storage is not implemented yet. Install and wire a secure-storage plugin in a later phase.");
  }
  remove(): Promise<void> {
    throw new Error("Native secure storage is not implemented yet. Install and wire a secure-storage plugin in a later phase.");
  }
}

export function getSecureStorage(): SecureStorage {
  return isNativeRuntime() ? new NativeSecureStorageNotImplemented() : new WebLocalStorageFallback();
}
