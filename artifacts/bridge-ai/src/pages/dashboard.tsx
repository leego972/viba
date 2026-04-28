import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { useListSessions, getListSessionsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Activity, Clock, DollarSign } from "lucide-react";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: sessions, isLoading, isError } = useListSessions();

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active": return "default";
      case "completed": return "secondary";
      case "stopped": return "destructive";
      case "paused": return "outline";
      case "pending": return "outline";
      default: return "outline";
    }
  };

  return (
    <AppLayout>
      <div className="flex flex-col space-y-8">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-muted-foreground">Manage your AI bridge sessions</p>
          </div>
          <Link href="/sessions/new">
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              New Session
            </Button>
          </Link>
        </div>

        {isLoading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(3)].map((_, i) => (
              <Card key={i}>
                <CardHeader className="gap-2">
                  <Skeleton className="h-5 w-1/3" />
                  <Skeleton className="h-4 w-full" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-10 w-full" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : isError ? (
          <div className="text-center py-12 rounded-lg border border-destructive bg-destructive/10">
            <p className="text-destructive font-medium">Failed to load sessions. Is the server running?</p>
          </div>
        ) : !sessions || sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center animate-in fade-in-50">
            <div className="mx-auto flex max-w-[420px] flex-col items-center justify-center text-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted">
                <Activity className="h-10 w-10 text-muted-foreground" />
              </div>
              <h2 className="mt-6 text-xl font-semibold">No sessions created</h2>
              <p className="mb-8 mt-2 text-center text-sm font-normal leading-6 text-muted-foreground">
                You haven't created any bridge sessions yet. Start by creating a new session and assigning agents.
              </p>
              <Link href="/sessions/new">
                <Button>Start a Session</Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => (
              <Link key={session.id} href={`/sessions/${session.id}`}>
                <Card className="hover-elevate cursor-pointer transition-all hover:border-primary/50 h-full flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex justify-between items-start gap-4">
                      <Badge variant={getStatusColor(session.status) as any} className="capitalize">
                        {session.status}
                      </Badge>
                      <Badge variant="outline" className="text-xs font-normal">
                        {session.autonomyMode}
                      </Badge>
                    </div>
                    <CardTitle className="line-clamp-2 mt-2 text-lg">
                      {session.goal || "Untitled Session"}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-3 flex-1">
                    <div className="flex flex-col space-y-2 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4" />
                        <span>{format(new Date(session.createdAt), "MMM d, yyyy h:mm a")}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <DollarSign className="h-4 w-4" />
                        <span>Est. Cost: ${session.estimatedCost?.toFixed(4) || "0.0000"}</span>
                      </div>
                    </div>
                  </CardContent>
                  <CardFooter className="pt-0">
                    <Button variant="ghost" className="w-full text-primary hover:text-primary">
                      Open Workspace
                    </Button>
                  </CardFooter>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppLayout>
  );
}
