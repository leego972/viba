import { useQuery } from "@tanstack/react-query";

async function verifyAdminSession(): Promise<boolean> {
  try {
    const response = await fetch("/api/admin/overview", {
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Server-confirmed administrator status. Browser storage is never trusted. */
export function useAdminAccess(enabled: boolean) {
  const query = useQuery({
    queryKey: ["auth", "admin-access"],
    queryFn: verifyAdminSession,
    enabled,
    retry: false,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  return {
    isAdmin: query.data === true,
    isLoading: enabled && query.isLoading,
  };
}
