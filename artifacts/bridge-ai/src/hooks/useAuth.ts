import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
  subscriptionStatus?: string;
  creditsRemaining?: number;
  creditsPeriodEnd?: string | null;
}

async function fetchMe(): Promise<AuthUser | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch("/api/auth/me", { credentials: "include", signal: controller.signal });
    if (res.status === 401) return null;
    if (!res.ok) return null;
    return res.json() as Promise<AuthUser>;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function useAuth() {
  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: 1,
    retryDelay: 800,
    staleTime: 60 * 1000,
    refetchOnWindowFocus: true,
  });

  return {
    user: user ?? null,
    isLoading,
    isAuthenticated: !!user,
  };
}

export function useLogout() {
  const queryClient = useQueryClient();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    queryClient.setQueryData(["auth", "me"], null);
    window.location.href = "/login";
  };
}
