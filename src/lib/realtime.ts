import { useEffect } from "react";
import { supabase } from "./supabase";
import { useQueryClient } from "@tanstack/react-query";

/**
 * Subscribe to realtime changes on a table and invalidate the given query keys.
 * Safe: unsubscribes on unmount; skips if user has no session.
 */
export function useRealtimeInvalidate(table: string, keys: string[][], userId?: string | null) {
  const qc = useQueryClient();
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`rt:${table}:${userId}:${Math.random().toString(36).slice(2, 10)}`)

      .on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => {
          for (const k of keys) qc.invalidateQueries({ queryKey: k });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, userId, qc]);
}

export function formatRelative(date?: string | null): string {
  if (!date) return "—";
  const d = new Date(date);
  const diff = Date.now() - d.getTime();
  if (isNaN(diff)) return "—";
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export function isOnline(lastSeen?: string | null, thresholdMs = 5 * 60 * 1000): boolean {
  if (!lastSeen) return false;
  return Date.now() - new Date(lastSeen).getTime() < thresholdMs;
}

export function formatMs(ms: number): string {
  if (!ms || ms < 0) ms = 0;
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** Human-readable duration for a single usage event. */
export function formatDuration(ms: number | null | undefined): string {
  const n = Number(ms ?? 0);
  if (!n || n <= 0) return "Opened";
  const s = Math.floor(n / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rs = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${rs}s`;
}

export function usageTime(row: any): string | null {
  return row?.opened_at ?? row?.event_time ?? row?.recorded_at ?? row?.created_at ?? null;
}

export function usageDurationMs(row: any): number {
  return Number(
    row?.duration_millis ?? row?.duration_ms ?? row?.foreground_time_ms ?? row?.total_time_ms ?? 0,
  );
}
