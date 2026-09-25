/**
 * Checkpoint 1 — "the native app came back to the foreground".
 *
 * Capacitor already dispatches a `resume` event on `document` when the app
 * returns to the foreground, on both platforms, with no extra plugin:
 *  - Android: the bridge's built-in Cordova-compat web view fires it from
 *    Activity onResume, after the app has been paused at least once
 *    (node_modules/@capacitor/android/.../cordova/MockCordovaWebViewImpl.java
 *    handleResume).
 *  - iOS: CapacitorBridge observes UIScene.willEnterForegroundNotification
 *    and fires it once the page has loaded (CapacitorBridge.swift
 *    setupCordovaCompatibility / triggerSceneLifecycleJSEvent).
 * Neither fires on a cold start, which the startup/auth trigger already
 * covers. @capacitor/app is deliberately not required: it isn't a declared
 * dependency here, and adding it would mean a native project sync on both
 * platforms for no extra capability.
 *
 * Callers must gate on isNativeRuntime() — a browser never dispatches this
 * event, but the web app has no reason to listen for it either.
 */
export const NATIVE_RESUME_EVENT = "resume";

export type ResumeEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

export function subscribeToNativeResume(target: ResumeEventTarget, onResume: () => void): () => void {
  const listener = () => onResume();
  target.addEventListener(NATIVE_RESUME_EVENT, listener);
  return () => target.removeEventListener(NATIVE_RESUME_EVENT, listener);
}
