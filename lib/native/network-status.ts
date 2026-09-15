/**
 * Boundary interface only (Phase 1A). One implementation serves both web and
 * native today since `navigator.onLine`/online/offline events are available
 * inside a Capacitor WebView too — not a Capacitor API, just a browser one.
 *
 * Known limitation: `navigator.onLine` is known to be unreliable on some
 * WebView/platform combinations (false positives on captive portals, etc).
 * Phase 2 should swap this implementation for @capacitor/network, which
 * queries the OS directly — callers of this interface won't need to change.
 */
export interface NetworkStatus {
  isOnline(): boolean;
  subscribe(onChange: (online: boolean) => void): () => void;
}

class BrowserNetworkStatus implements NetworkStatus {
  isOnline(): boolean {
    return typeof navigator === "undefined" ? true : navigator.onLine;
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

export function getNetworkStatus(): NetworkStatus {
  return new BrowserNetworkStatus();
}
