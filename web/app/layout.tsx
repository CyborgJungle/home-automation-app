import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque } from "next/font/google";
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
  themeColor: "#f4eee3",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={font.variable}>
      <body>{children}</body>
    </html>
  );
}
