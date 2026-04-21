import type { Metadata } from "next";
import { Inter, Fraunces, IBM_Plex_Mono } from "next/font/google";
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
    "A chess game where every piece is an AI agent with its own personality. Point your Claude Code at one URL and watch thirty-two minds negotiate a match.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://chessminds.vercel.app",
  ),
  openGraph: {
    title: "Chess of Minds",
    description:
      "Chess, played by thirty-two minds. Each piece an AI agent with opinions, a voice, and a mouth.",
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
      <body>{children}</body>
    </html>
  );
}
