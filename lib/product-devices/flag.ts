/**
 * Reversible Product Devices pilot feature flag.
 *
 * Flag: NEXT_PUBLIC_PRODUCT_DEVICES_PILOT
 * Values:
 *   - unset / "off" / "false" / "0" → disabled (default)
 *   - "linxup" → LinxUp company only
 *   - "admin" → global admins only (caller must pass isGlobalAdmin)
 *   - "linxup_admin" → LinxUp company AND global admin
 *   - "all" → all companies (local testing only)
 *
 * Immediate disable: set to off / unset and restart next dev / redeploy env.
 * Production path when disabled: existing Product / Install Type picker unchanged.
 */

export type ProductDevicesPilotMode = "off" | "linxup" | "admin" | "linxup_admin" | "all";

export const PRODUCT_DEVICES_PILOT_ENV = "NEXT_PUBLIC_PRODUCT_DEVICES_PILOT";

export function parseProductDevicesPilotMode(
  raw: string | undefined | null,
): ProductDevicesPilotMode {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v || v === "off" || v === "false" || v === "0" || v === "no") return "off";
  if (v === "linxup") return "linxup";
  if (v === "admin") return "admin";
  if (v === "linxup_admin" || v === "linxup+admin") return "linxup_admin";
  if (v === "all" || v === "on" || v === "true" || v === "1") return "all";
  return "off";
}

export function readProductDevicesPilotModeFromEnv(): ProductDevicesPilotMode {
  return parseProductDevicesPilotMode(
    typeof process !== "undefined" ? process.env.NEXT_PUBLIC_PRODUCT_DEVICES_PILOT : undefined,
  );
}

export function isProductDevicesPilotEnabled(args: {
  mode?: ProductDevicesPilotMode;
  companyName?: string | null;
  isGlobalAdmin?: boolean;
}): boolean {
  const mode = args.mode ?? readProductDevicesPilotModeFromEnv();
  if (mode === "off") return false;
  if (mode === "all") return true;
  const isLinxUp = (args.companyName ?? "").trim().toLowerCase() === "linxup";
  if (mode === "linxup") return isLinxUp;
  if (mode === "admin") return args.isGlobalAdmin === true;
  if (mode === "linxup_admin") return isLinxUp && args.isGlobalAdmin === true;
  return false;
}
