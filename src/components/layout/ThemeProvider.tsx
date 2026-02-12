"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey="codepilot-theme"
      // 🔧 移除 disableTransitionOnChange，确保主题切换生效
    >
      {children}
    </NextThemesProvider>
  );
}
