import type { Metadata, Viewport } from "next";
import "./globals.css";

/**
 * Deliberately minimal shell — no AuthStatusBar/providers/OnboardingGate.
 * Those are root-app chrome applied via the web app's own app/layout.tsx,
 * not part of the LoginScreen component itself. This proof only needs the
 * real shared styling (Tailwind via globals.css) and the real LoginScreen.
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
      <body className="min-h-full">{children}</body>
    </html>
  );
}
