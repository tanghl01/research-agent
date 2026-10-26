import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import { LocalExtensionErrorFilter } from "@/components/local-extension-error-filter";
import "./globals.css";

export const metadata: Metadata = {
  title: "算子",
  description: "Mastra-based task agent platform",
  icons: {
    icon: [
      {
        url: "/brand/operator-favicon.png",
        type: "image/png",
        sizes: "64x64"
      }
    ],
    apple: "/brand/operator-favicon.png"
  }
};

export const runtime = "nodejs";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <LocalExtensionErrorFilter />
      </head>
      <body>{children}</body>
    </html>
  );
}
