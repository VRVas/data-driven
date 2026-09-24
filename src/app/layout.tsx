import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { stackNotch, stackText } from "./fonts";
import { GrainOverlay } from "@/components/fx/GrainOverlay";
import "./globals.css";

export const metadata: Metadata = {
  title: "OOVIE - Business Development Intelligence",
  description:
    "Client segmentation, lead scoring and sales strategy for OOVIE Studios - turned into a live, interactive intelligence platform.",
  applicationName: "OOVIE BD Intelligence",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${stackNotch.variable} ${stackText.variable} ${GeistMono.variable}`}
    >
      <body className="bg-field min-h-screen antialiased">
        {children}
        <GrainOverlay />
      </body>
    </html>
  );
}
