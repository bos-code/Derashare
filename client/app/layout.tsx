import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dera Share",
  description: "Send text instantly between two paired devices.",
  applicationName: "Dera Share",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Dera Share", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#111827", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
