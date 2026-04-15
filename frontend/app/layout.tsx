import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Fluke Load Calculation Viewer",
  description: "Next.js frontend for visualizing Fluke 3540 FC load calculation sessions.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
