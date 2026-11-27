import { useCallback, useEffect, useRef, useState } from "react";
import { getSwapRequests, type DeskRequest } from "@/components/team/service";

/** How often the office checks for new swap requests while the tab is visible. */
export const SWAP_POLL_MS = 30_000;

/**
 * Desk swap requests waiting for the viewer's answer, so the office can show a
 * badge without opening the members panel. Checks every 30 s while the tab is
 * visible, again when it comes back into view, and whenever `refresh` is called.
 * `onNew` hears about requests that weren't there on the previous check.
 */
export function useSwapRequests(workspaceId: string | undefined, onNew?: (fresh: DeskRequest[]) => void) {
  const [waiting, setWaiting] = useState<DeskRequest[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const onNewRef = useRef(onNew);
  useEffect(() => {
    onNewRef.current = onNew;
  });

  const refresh = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const { requests } = await getSwapRequests(workspaceId);
      const incoming = requests.filter((r) => r.direction === "incoming");
      const fresh = incoming.filter((r) => !seen.current?.has(r.requestId));
      seen.current = new Set(incoming.map((r) => r.requestId));
      setWaiting(incoming);
      if (fresh.length) onNewRef.current?.(fresh);
    } catch (err) {
      // Keep the last known badge; the next check tries again.
      console.error("[office] couldn't check desk swap requests", err);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    refresh();
    const timer = setInterval(() => document.visibilityState === "visible" && refresh(), SWAP_POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [workspaceId, refresh]);

  return { waiting, refresh };
}
