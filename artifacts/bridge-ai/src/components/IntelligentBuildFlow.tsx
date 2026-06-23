import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Brain, CheckCircle2, ClipboardCheck, Coins, FileCheck2, GitBranch, ListChecks, Wrench } from "lucide-react";

type IntelligentBuildFlowProps = {
  status?: string;
  hasTasks?: boolean;
  hasApprovals?: boolean;
  hasReceipts?: boolean;
  hasFinalOutput?: boolean;
};

const FLOW = [
  { label: "Plan", detail: "Break down goal", icon: Brain },
  { label: "Route", detail: "Choose specialists", icon: GitBranch },
  { label: "Estimate", detail: "Credits and cap", icon: Coins },
  { label: "Approve", detail: "Owner gate", icon: ClipboardCheck },
  { label: "Work", detail: "Staged progress", icon: Wrench },
  { label: "Verify", detail: "Evidence report", icon: FileCheck2 },
];

function currentStep(input: IntelligentBuildFlowProps): number {
  if (input.status === "completed" || input.hasFinalOutput) return 5;
  if (input.hasReceipts) return 4;
  if (input.hasApprovals) return 3;
  if (input.hasTasks) return 2;
  if (input.status === "active" || input.status === "paused") return 1;
  return 0;
}

export function IntelligentBuildFlow(props: IntelligentBuildFlowProps) {
  const current = currentStep(props);
  return (
    <Card className="shrink-0 border-border/70 shadow-sm">
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium">AI collaboration flow</p>
            <p className="text-xs text-muted-foreground">A clear path from plan to verified result.</p>
          </div>
          <Badge variant="outline" className="gap-1">
            <ListChecks className="h-3 w-3" />
            Controlled workflow
          </Badge>
        </div>
        <div className="grid gap-2 md:grid-cols-6">
          {FLOW.map(({ label, detail, icon: Icon }, index) => {
            const done = index < current;
            const active = index === current;
            return (
              <div
                key={label}
                className={`rounded-xl border px-3 py-3 transition-colors ${
                  done
                    ? "border-emerald-500/25 bg-emerald-500/5"
                    : active
                      ? "border-primary/40 bg-primary/10"
                      : "border-border/60 bg-muted/20"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Icon className={`h-4 w-4 ${active ? "text-primary" : done ? "text-emerald-400" : "text-muted-foreground"}`} />
                  {done && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />}
                </div>
                <p className="mt-2 text-sm font-medium">{label}</p>
                <p className="text-xs text-muted-foreground">{detail}</p>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
