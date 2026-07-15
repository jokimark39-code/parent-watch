import { useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { scanAndCreateAlerts } from "@/lib/risk-scanner";
import { useQueryClient } from "@tanstack/react-query";

const INTERVAL_MS = 30_000; // scan every 30s while signed in

/** Runs a periodic AI risk scan while the parent is signed in. */
export function useAlertScanner() {
  const { user } = useAuth();
  const uid = user?.id;
  const qc = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;

    const run = async () => {
      if (running.current) return;
      running.current = true;
      try {
        const r = await scanAndCreateAlerts(uid);
        if (!cancelled && r.inserted && r.inserted > 0) {
          qc.invalidateQueries({ queryKey: ["alerts"] });
          qc.invalidateQueries({ queryKey: ["alerts-unread-count"] });
          qc.invalidateQueries({ queryKey: ["dash"] });
        }
      } catch {
        // ignore, next tick will retry
      } finally {
        running.current = false;
      }
    };

    // initial + interval
    run();
    const id = window.setInterval(run, INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [uid, qc]);
}
