import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LR的单词本 · 英语词汇积累",
  description: "一份莫奈色系的英语单词卡片收藏模板。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
