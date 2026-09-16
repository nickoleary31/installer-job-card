import type { Metadata, Viewport } from "next";
import { AuthUserContextProvider } from "@/app/providers/AuthUserContextProvider";
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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <AuthUserContextProvider>{children}</AuthUserContextProvider>
      </body>
    </html>
  );
}
