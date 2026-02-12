"use client";

import { useEffect } from "react";

/**
 * Client-side initialization component
 * Handles Hub initialization without triggering SSR issues
 */
export function ClientInit() {
  useEffect(() => {
    // Dynamically import and initialize Hub
    import("@/lib/init")
      .then((mod) => mod.initializeHub())
      .catch((err) => console.error("[ClientInit] Failed to initialize Hub:", err));
  }, []);

  return null;
}
