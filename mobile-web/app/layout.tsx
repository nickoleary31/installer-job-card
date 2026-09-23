import type { Metadata, Viewport } from "next";
import { AuthUserContextProvider } from "@/app/providers/AuthUserContextProvider";
import { ForegroundSyncMount } from "@/components/ForegroundSyncMount";
import "./globals.css";

/**
 * Deliberately minimal shell compared to the web app's own app/layout.tsx —
 * no AuthStatusBar/OnboardingGate/InviteCallbackForwarder (chrome and
 * onboarding-redirect concerns out of scope for this narrow technician-path
 * slice; OnboardingGate specifically would redirect to /auth/accept-invite,
 * which mobile-web doesn't have as a route yet).
 *
 * AuthUserContextProvider IS required, not chrome: ActiveProjectsScreen,
 * ProjectDetailScreen, and NewSubmissionForm all call useAuthUserContext(),
 * whose context has no Provider default that ever resolves `loading` —
 * without this wrapper every screen would show a perpetual loading state.
 */
export const metadata: Metadata = {
  title: "Installer Sheetz",
  description: "Installer Sheetz mobile app shell",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  // Required for env(safe-area-inset-*) to resolve to a real value in the
  // Capacitor WKWebView instead of 0 — without this, the fixed top scrim
  // below (and the footer's existing safe-area padding in
  // NewSubmissionForm.tsx) would both collapse to zero height. Intentionally
  // no maximumScale/userScalable here — pinch-zoom stays available.
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        {/*
          Every screen scrolls the whole document (no per-screen scroll
          container), so a screen's own top padding scrolls away with its
          content — leaving nothing to stop subsequent content from sliding
          under the status bar / Dynamic Island. This fixed, opaque strip
          stays pinned above everything else regardless of scroll position,
          so that area is always covered (and, being a real element, can't
          be tapped through). Sized to the device's actual inset rather than
          a guessed constant so it's correct on any notch/Dynamic Island size.
        */}
        <div
          aria-hidden="true"
          className="fixed inset-x-0 top-0 z-40 bg-slate-50 dark:bg-slate-950"
          style={{ height: "env(safe-area-inset-top, 0px)" }}
        />
        <AuthUserContextProvider>
          <ForegroundSyncMount />
          {children}
        </AuthUserContextProvider>
      </body>
    </html>
  );
}
