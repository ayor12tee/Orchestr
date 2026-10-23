"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getBrowserClient } from "@/lib/supabase/client";

/**
 * Re-renders the current page's server data when another user changes a
 * watched table (brief §9.4). Supabase Realtime applies RLS, so users are only
 * notified about rows they're allowed to see. Bursts are debounced.
 */
export function RealtimeRefresh({ tables, filter }: { tables: string[]; filter?: string }) {
  const router = useRouter();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const key = tables.join(",") + (filter ?? "");

  useEffect(() => {
    const supabase = getBrowserClient();
    const channel = supabase.channel(`refresh:${key}`);
    for (const table of tables) {
      channel.on("postgres_changes", { event: "*", schema: "public", table, ...(filter ? { filter } : {}) }, () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => router.refresh(), 400);
      });
    }
    channel.subscribe();
    return () => {
      if (timer.current) clearTimeout(timer.current);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` captures tables + filter
  }, [key, router]);

  return null;
}
