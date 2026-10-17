import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
import Script from "next/script";
import { ThemeSync } from "@/lib/theme";
import { THEME_COLORS, THEME_SCRIPT } from "@/lib/theme-script";
import "./globals.css";

const font = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font", display: "swap" });

export const metadata: Metadata = {
  title: "Home Automation",
  description: "Lights, heating, blinds and more, in one place",
  // The name under the icon when added to the iPhone home screen.
  appleWebApp: { capable: true, title: "Home Automation", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEME_COLORS.light },
    { media: "(prefers-color-scheme: dark)", color: THEME_COLORS.dark },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={font.variable}>
      <head>
        {/* Follows the iPhone by default; Settings can pin light or dark (lib/theme.ts). */}
        <meta name="color-scheme" content="light dark" suppressHydrationWarning />
        <Script id="theme" strategy="beforeInteractive">
          {THEME_SCRIPT}
        </Script>
      </head>
      <body>
        <ThemeSync />
        {children}
      </body>
    </html>
  );
}
