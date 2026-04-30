import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthUserContextProvider } from "./providers/AuthUserContextProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TKP Installer",
  description: "%s | TKP Installer",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthUserContextProvider>{children}</AuthUserContextProvider>
      </body>
    </html>
  );
}
