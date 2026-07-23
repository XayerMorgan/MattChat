import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "MattChat",
  description:
    "MattChat — chat frontend for LM Studio and commercial APIs with side-by-side source A/B testing.",
  // opengraph-image.jpg / twitter-image.jpg in this folder are picked up automatically.
  openGraph: {
    title: "MattChat",
    description:
      "Chat frontend for LM Studio and commercial APIs with side-by-side A/B testing.",
    type: "website",
    siteName: "MattChat",
    images: [
      {
        url: "/social-preview.jpg",
        width: 1344,
        height: 768,
        alt: "MattChat",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "MattChat",
    description:
      "Chat frontend for LM Studio and commercial APIs with side-by-side A/B testing.",
    images: ["/social-preview.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      {/*
        suppressHydrationWarning: browser extensions inject attrs on <html>/<body>.
        Avoid next/script inline hacks here — React 19 logs errors for script tags
        rendered inside components on the client.
      */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
