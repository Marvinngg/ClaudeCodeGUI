"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import { NavRail } from "./NavRail";
import { ChatListPanel } from "./ChatListPanel";
import { RightPanel } from "./RightPanel";
import { PanelContext, type PanelContent } from "@/hooks/usePanel";

const LG_BREAKPOINT = 1024;

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  const [chatListOpen, setChatListOpenRaw] = useState(false);

  // Panel state
  const isChatRoute = pathname.startsWith("/chat/") || pathname === "/chat";
  const isChatDetailRoute = pathname.startsWith("/chat/");

  // Auto-close chat list when leaving chat routes
  const setChatListOpen = useCallback((open: boolean) => {
    setChatListOpenRaw(open);
  }, []);

  useEffect(() => {
    if (!isChatRoute) {
      setChatListOpenRaw(false);
    }
  }, [isChatRoute]);
  const [panelOpen, setPanelOpenRaw] = useState(false);
  const [panelContent, setPanelContent] = useState<PanelContent>("files");
  const [workingDirectory, setWorkingDirectory] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [sessionTitle, setSessionTitle] = useState("");
  const [streamingSessionId, setStreamingSessionId] = useState("");
  const [pendingApprovalSessionId, setPendingApprovalSessionId] = useState("");

  // 🔧 右侧面板宽度状态（可拖拽调节）
  const [rightPanelWidth, setRightPanelWidth] = useState(288); // 默认 18rem = 288px
  const [isResizing, setIsResizing] = useState(false);

  // Auto-open panel on chat detail routes, close on others
  useEffect(() => {
    setPanelOpenRaw(isChatDetailRoute);
  }, [isChatDetailRoute]);

  const setPanelOpen = useCallback((open: boolean) => {
    setPanelOpenRaw(open);
  }, []);

  // Keep chat list state in sync when resizing across the breakpoint (only on chat routes)
  useEffect(() => {
    if (!isChatRoute) return;
    const mql = window.matchMedia(`(min-width: ${LG_BREAKPOINT}px)`);
    const handler = (e: MediaQueryListEvent) => setChatListOpenRaw(e.matches);
    mql.addEventListener("change", handler);
    setChatListOpenRaw(mql.matches);
    return () => mql.removeEventListener("change", handler);
  }, [isChatRoute]);

  // 🔧 拖拽调节右侧面板宽度
  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newWidth = window.innerWidth - e.clientX;
      // 限制宽度在 200px - 600px 之间
      const clampedWidth = Math.min(Math.max(newWidth, 200), 600);
      setRightPanelWidth(clampedWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  const panelContextValue = useMemo(
    () => ({
      panelOpen,
      setPanelOpen,
      panelContent,
      setPanelContent,
      workingDirectory,
      setWorkingDirectory,
      sessionId,
      setSessionId,
      sessionTitle,
      setSessionTitle,
      streamingSessionId,
      setStreamingSessionId,
      pendingApprovalSessionId,
      setPendingApprovalSessionId,
    }),
    [panelOpen, setPanelOpen, panelContent, workingDirectory, sessionId, sessionTitle, streamingSessionId, pendingApprovalSessionId]
  );

  return (
    <PanelContext.Provider value={panelContextValue}>
      <TooltipProvider delayDuration={300}>
        <div className="flex h-screen overflow-hidden">
          <NavRail
            chatListOpen={chatListOpen}
            onToggleChatList={() => setChatListOpen(!chatListOpen)}
          />
          <ChatListPanel open={chatListOpen} />
          <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
            {/* Electron draggable title bar region */}
            <div
              className="h-11 w-full shrink-0"
              style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
            />
            <main className="relative flex-1 overflow-hidden">{children}</main>
          </div>
          {isChatDetailRoute && panelOpen && (
            <>
              {/* 🔧 拖拽分隔条 */}
              <div
                className="group relative w-1 shrink-0 cursor-col-resize bg-border/30 hover:bg-primary/50 transition-colors"
                onMouseDown={() => setIsResizing(true)}
                style={{ userSelect: isResizing ? 'none' : 'auto' }}
              >
                <div className="absolute inset-y-0 -left-1 -right-1" />
              </div>
              {/* 🔧 右侧面板（可调节宽度） */}
              <div style={{ width: `${rightPanelWidth}px` }} className="shrink-0">
                <RightPanel />
              </div>
            </>
          )}
          {/* 🔧 面板关闭时显示打开按钮 */}
          {isChatDetailRoute && !panelOpen && (
            <div className="flex flex-col items-center gap-2 bg-background p-2 border-l border-border/30">
              <button
                onClick={() => setPanelOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Open panel"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                >
                  <rect width="18" height="18" x="3" y="3" rx="2" />
                  <path d="M15 3v18" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </TooltipProvider>
    </PanelContext.Provider>
  );
}
