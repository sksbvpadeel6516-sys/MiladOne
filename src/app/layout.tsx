import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "MiladOne | Real-Time Judge Scoring Platform",
  description:
    "Professional real-time scoring platform for competitions and events. Admin room management, live judge scoring, and instant leaderboards.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body className={inter.className}>{children}</body>
    </html>
  );
}
