import localFont from "next/font/local";

/**
 * Brand typefaces (OFL, self-hosted).
 * - Notch  -> display / headings (h1, h2)
 * - Text   -> body copy, UI, data
 * Both are variable fonts (weight axis), exposed as CSS variables.
 */
export const stackNotch = localFont({
  src: "./fonts/StackSansNotch.woff2",
  variable: "--font-notch",
  weight: "100 900",
  display: "swap",
  preload: true,
});

export const stackText = localFont({
  src: "./fonts/StackSansText.woff2",
  variable: "--font-text",
  weight: "100 900",
  display: "swap",
  preload: true,
});
