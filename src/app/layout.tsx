import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  // Absolute fallback for share cards when the app is hosted on a public origin:
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

/**
 * One-shot strip of extension attrs on <html>/<body>.
 * Do NOT use MutationObserver here — mutating the DOM while React hydrates
 * causes Runtime TypeError: Cannot read properties of null (reading 'removeChild').
 */
const STRIP_EXTENSION_ATTRS = `
(function () {
  var RE = /^(data-feedly|data-new-gr|data-gr-|data-gramm|data-darkreader|data-bitwarden|bis_)/i;
  function clean(el) {
    if (!el || !el.attributes) return;
    var remove = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var n = el.attributes[i].name;
      if (RE.test(n) || n === "data-feedly-mini") remove.push(n);
    }
    for (var j = 0; j < remove.length; j++) {
      try { el.removeAttribute(remove[j]); } catch (e) {}
    }
  }
  function run() {
    try {
      clean(document.documentElement);
      clean(document.body);
    } catch (e) {}
  }
  run();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run, { once: true });
  }
})();
`;

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
      <body suppressHydrationWarning>
        <Script
          id="strip-extension-attrs"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: STRIP_EXTENSION_ATTRS }}
        />
        {children}
      </body>
    </html>
  );
}
