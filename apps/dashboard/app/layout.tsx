import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { DashboardShell } from "@/components/shell";

export const metadata: Metadata = {
  title: "WeChat AI Content Dashboard",
  description: "Local-only editorial dashboard for the WeChat AI content agent."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <DashboardShell>{children}</DashboardShell>
      </body>
    </html>
  );
}
