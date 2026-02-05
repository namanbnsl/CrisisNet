import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";

// @ts-ignore
import "./globals.css";

const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: "CrisisNet",
  description: "Developed for TISBHacks2026",
  icons: { icon: "/icon.png" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={dmSans.variable}>
      <body className={`${dmSans.variable} antialiased`}>{children}</body>
    </html>
  );
}
