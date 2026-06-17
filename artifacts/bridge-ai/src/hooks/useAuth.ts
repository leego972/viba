import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface AuthUser {
  id: number;
  email: string;
  name: string | null;
}

async function fetchMe(): Promise<AuthUser | null> {
  const res = await fetch("/api/auth/me", { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) return null;
  return res.json() as Promise<AuthUser>;
}

export function useAuth() {
  const { data: user, isLoading } = useQuery({
    queryKey: ["auth", "me"],
    queryFn: fetchMe,
    retry: 1,
    retryDelay: 800,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
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
