import { isNativeRuntime } from "./runtime.ts";

/**
 * Boundary interface only. Phase 1A used one `navigator.onLine`-based
 * implementation for both platforms since online/offline events are
 * available inside a Capacitor WebView too — not a Capacitor API, just a
 * browser one. Phase 2A adds a real native implementation below, backed by
 * @capacitor/network, which queries the OS directly instead of relying on
 * the browser's known-unreliable online/offline signal.
 */
export interface NetworkStatus {
  isOnline(): boolean;
  subscribe(onChange: (online: boolean) => void): () => void;
  /**
   * Always performs a real, awaited check rather than returning any cached
   * value — for safety-critical one-shot decisions (e.g. Phase 2C's
   * offline-provisioning gate in lib/auth/auth-state.ts) where reading a
   * stale `isOnline()` snapshot before it self-corrects could misclassify
   * a genuinely offline device as online, or vice versa. `isOnline()`
   * remains the fast, synchronous, best-effort snapshot for everything else
   * — a brief staleness window there is an accepted tradeoff, not here.
   */
  isOnlineFresh(): Promise<boolean>;
}

class BrowserNetworkStatus implements NetworkStatus {
  isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
  }

  async isOnlineFresh(): Promise<boolean> {
    // navigator.onLine has no caching layer of its own to go stale.
    return this.isOnline();
  }

  subscribe(onChange: (online: boolean) => void): () => void {
    if (typeof window === "undefined") return () => {};
    const handleOnline = () => onChange(true);
    const handleOffline = () => onChange(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }
}

/**
 * @capacitor/network queries the OS directly instead of relying on
 * `navigator.onLine`/online/offline browser events. Dynamically imported
 * inside each method — never at module load — same safety pattern as the
 * other three new native packages in this Phase.
 *
 * `isOnline()` must stay synchronous to match this file's existing interface,
 * so the native status is cached from an async `getStatus()` call kicked off
 * eagerly in the constructor and kept fresh by the `networkStatusChange`
 * listener. Per the Phase 2 design principle, this is only ever a SYNC
 * OPPORTUNITY signal — callers must not depend on it being instantaneously
 * accurate or on a change event firing.
 *
 * Bug fixed here (found via Phase 2C's cold-start-while-offline testing):
 * the constructor's one-time refreshOnce() correcting the optimistic
 * `connected = true` default previously never notified anything already
 * subscribed at that moment — a component reading isOnline() synchronously
 * on mount (before that correction lands) could stay wrong for the rest of
 * the session, since nothing re-notifies unless an actual LATER transition
 * event fires. refreshOnce() now notifies every current subscriber too.
 */
class NativeCapacitorNetworkStatus implements NetworkStatus {
  private connected = true;
  private listeners = new Set<(online: boolean) => void>();

  constructor() {
    void this.refreshOnce();
  }

  private notify(connected: boolean): void {
    this.connected = connected;
    for (const listener of this.listeners) listener(connected);
  }

  private async refreshOnce(): Promise<void> {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    this.notify(status.connected);
  }

  isOnline(): boolean {
    return this.connected;
  }

  async isOnlineFresh(): Promise<boolean> {
    const { Network } = await import("@capacitor/network");
    const status = await Network.getStatus();
    this.notify(status.connected);
    return status.connected;
  }

  subscribe(onChange: (online: boolean) => void): () => void {
    this.listeners.add(onChange);

    let unsubscribed = false;
    let handle: { remove(): Promise<void> } | null = null;
    void (async () => {
      const { Network } = await import("@capacitor/network");
      const listenerHandle = await Network.addListener("networkStatusChange", (status) => {
        this.notify(status.connected);
      });
      if (unsubscribed) {
        await listenerHandle.remove();
        return;
      }
      handle = listenerHandle;
    })();
    return () => {
      unsubscribed = true;
      this.listeners.delete(onChange);
      void handle?.remove();
    };
  }
}

/**
 * A fresh instance defaults `connected` to `true` until its async
 * `refreshOnce()` resolves, so a caller doing `getNetworkStatus().isOnline()`
 * in one expression (no await in between) would always read the stale
 * default instead of a real status — worse, a later instance's listener
 * would never see events that happened before it was constructed. One
 * shared instance for the app's lifetime keeps `connected` genuinely live.
 */
let nativeNetworkStatusSingleton: NativeCapacitorNetworkStatus | null = null;

export function getNetworkStatus(): NetworkStatus {
  if (!isNativeRuntime()) return new BrowserNetworkStatus();
  if (!nativeNetworkStatusSingleton) nativeNetworkStatusSingleton = new NativeCapacitorNetworkStatus();
  return nativeNetworkStatusSingleton;
}
