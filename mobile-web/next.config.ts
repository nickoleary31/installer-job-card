import type { NextConfig } from "next";
import { join } from "node:path";

/**
 * Phase 1B proof: static export of the shared Installer Sheetz UI for
 * packaging into Capacitor. No app/api here at all — this project only
 * ever renders UI reused from the root app's lib/ and components/ via the
 * `@/*` path alias in tsconfig.json (pointed at the repo root, one level
 * up). See docs/Mobile_Development.md for the full rationale.
 */
const nextConfig: NextConfig = {
  output: "export",
  // This project imports lib/ and components/ from the parent directory (see
  // tsconfig.json's `@/*` alias), so the workspace root must be the PARENT
  // directory, not this one — narrowing it to __dirname breaks resolution
  // of anything imported from outside mobile-web/. This matches what
  // Turbopack's own auto-inference already picked; setting it explicitly
  // just silences the "detected multiple lockfiles" warning.
  turbopack: {
    root: join(__dirname, ".."),
  },
};

export default nextConfig;
