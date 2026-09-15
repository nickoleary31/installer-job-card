import { Capacitor } from "@capacitor/core";

/**
 * True when running inside the Capacitor native shell (iOS/Android WebView),
 * false in a normal browser or installed PWA. Safe to call in both — on the
 * web this is just a static `false`, no Capacitor runtime cost.
 */
export function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

export function nativePlatform(): "ios" | "android" | "web" {
  return Capacitor.getPlatform() as "ios" | "android" | "web";
}
