import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { ServiceWorkerRegistration } from "@/components/sw-register";
import "./globals.css";

const cormorant = localFont({
  src: [
    { path: "./fonts/cormorantgaramond-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/cormorantgaramond-700.woff2", weight: "700", style: "normal" },
  ],
  variable: "--font-cormorant",
  display: "swap",
});

const mulish = localFont({
  src: [
    { path: "./fonts/mulish-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/mulish-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/mulish-700.woff2", weight: "700", style: "normal" },
    { path: "./fonts/mulish-800.woff2", weight: "800", style: "normal" },
  ],
  variable: "--font-mulish",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Legacy Independent Living", template: "%s · Legacy Independent Living" },
  description: "Resident and owner portal for Legacy Independent Living.",
  applicationName: "Legacy Living",
  appleWebApp: { capable: true, title: "Legacy Living", statusBarStyle: "default" },
  icons: {
    icon: [
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  robots: { index: false, follow: false },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#4a5533",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${mulish.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:font-bold">
          Skip to content
        </a>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
