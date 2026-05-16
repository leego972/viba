import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
  getGetBannerDismissalQueryKey,
} from "@workspace/api-client-react";
import { SIMULATED_PREFIX } from "../lib/bannerLogic";

export function useSessionStream(sessionId: number) {
  const queryClient = useQueryClient();
  const latestSimulatedTimestampRef = useRef<string | null>(null);

  useEffect(() => {
    // Reset tracked timestamp whenever the session changes so a new session
    // with earlier timestamps doesn't suppress banner invalidation.
    latestSimulatedTimestampRef.current = null;

    if (!sessionId) return;

    const url = `/api/sessions/${sessionId}/stream`;
    const es = new EventSource(url);

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (data.session != null)
          queryClient.setQueryData(getGetSessionQueryKey(sessionId), data.session);
        if (Array.isArray(data.messages)) {
          queryClient.setQueryData(getListMessagesQueryKey(sessionId), data.messages);

          // Invalidate the banner-dismissal query when a new simulated message arrives
          // so the banner reliably re-appears across all open tabs/devices.
          const messages = data.messages as Array<{ content?: string; createdAt?: string }>;
          const latestSimulated = messages
            .filter((m) => m.content?.startsWith(SIMULATED_PREFIX) && m.createdAt)
            .reduce<string | null>((latest, m) => {
              if (!m.createdAt) return latest;
              return latest === null || m.createdAt > latest ? m.createdAt : latest;
            }, null);

          if (
            latestSimulated !== null &&
            (latestSimulatedTimestampRef.current === null ||
              latestSimulated > latestSimulatedTimestampRef.current)
          ) {
            latestSimulatedTimestampRef.current = latestSimulated;
            void queryClient.invalidateQueries({
              queryKey: getGetBannerDismissalQueryKey(sessionId),
            });
          }
        }
        if (Array.isArray(data.tasks))
          queryClient.setQueryData(getListTasksQueryKey(sessionId), data.tasks);
        if (Array.isArray(data.approvals))
          queryClient.setQueryData(getListApprovalsQueryKey(sessionId), data.approvals);
        if (Array.isArray(data.auditLogs))
          queryClient.setQueryData(getListAuditLogsQueryKey(sessionId), data.auditLogs);
        if (Array.isArray(data.agents))
          queryClient.setQueryData(["sessions", sessionId, "agents"] as const, data.agents);
      } catch {
        // ignore malformed SSE frames
      }
    };

    es.onerror = () => {
      // EventSource reconnects automatically
    };

    return () => es.close();
  }, [sessionId, queryClient]);
}
