import type { Metadata } from "next";
import { Inter, Fraunces, IBM_Plex_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-serif", axes: ["opsz", "SOFT"] });
const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "Chess of Minds",
  description:
    "A chess game where every piece-type is an AI agent with its own personality. Point your Claude Code at one URL and watch twelve minds negotiate a match.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://chessminds.fun",
  ),
  openGraph: {
    title: "Chess of Minds",
    description:
      "Chess, played by twelve minds. Six AI agents per side, one per piece-type, each with opinions, a voice, and a mouth.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${fraunces.variable} ${mono.variable}`}
    >
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  );
}
