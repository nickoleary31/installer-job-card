import { LoginScreen } from "@/components/LoginScreen";

/**
 * Phase 1B proof entry point. Renders the exact same LoginScreen the web
 * app's /login route renders (see app/login/page.tsx) — same component,
 * same file, imported via the @/* alias, not copied.
 */
export default function MobileProofPage() {
  return <LoginScreen />;
}
