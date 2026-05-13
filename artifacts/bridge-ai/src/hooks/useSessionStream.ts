import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSessionQueryKey,
  getListMessagesQueryKey,
  getListTasksQueryKey,
  getListApprovalsQueryKey,
  getListAuditLogsQueryKey,
} from "@workspace/api-client-react";

export function useSessionStream(sessionId: number) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!sessionId) return;

    const url = `/api/sessions/${sessionId}/stream`;
    const es = new EventSource(url);

    es.onmessage = (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data as string) as Record<string, unknown>;
        if (data.session != null)
          queryClient.setQueryData(getGetSessionQueryKey(sessionId), data.session);
        if (Array.isArray(data.messages))
          queryClient.setQueryData(getListMessagesQueryKey(sessionId), data.messages);
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
