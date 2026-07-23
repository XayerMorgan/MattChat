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
};

/**
 * Browser extensions (Feedly, Grammarly, Dark Reader, etc.) inject attributes
 * onto <html>/<body> before React hydrates, which triggers noisy hydration
 * mismatch warnings. Strip known extension attrs as early as possible.
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
    for (var j = 0; j < remove.length; j++) el.removeAttribute(remove[j]);
  }
  function run() {
    clean(document.documentElement);
    clean(document.body);
  }
  run();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  }
  try {
    var obs = new MutationObserver(function () { run(); });
    obs.observe(document.documentElement, { attributes: true, subtree: false });
    if (document.body) {
      obs.observe(document.body, { attributes: true, subtree: false });
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        if (document.body) obs.observe(document.body, { attributes: true, subtree: false });
      });
    }
    setTimeout(function () { obs.disconnect(); }, 8000);
  } catch (e) {}
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
