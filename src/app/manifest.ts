import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Legacy Independent Living",
    short_name: "Legacy Living",
    description: "Pay rent, see your balance and receipts, and manage Legacy Independent Living homes.",
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#fbf8f1",
    theme_color: "#4a5533",
    categories: ["business", "finance", "lifestyle"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Pay rent", url: "/pay", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Payments", url: "/payments", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
