import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ArrowRight, CheckCircle2, ClipboardCheck, Copy, EyeOff, LockKeyhole, ShieldCheck, Target, TrendingUp, Workflow } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const steps = [
  "Advertise the buyer need, not a business weakness.",
  "Capture the request inside a permission-based intake flow.",
  "Score fit, urgency, budget signal, clarity, and delivery risk.",
  "Route the work to VIBA agents for beta testing, repair planning, and launch-readiness review.",
  "Package the result as a report, repair sprint, monthly protection plan, or approved partner handoff.",
];

const agentCards = [
  ["Signal Agent", "Qualifies buyer intent, urgency, budget signal, and missing details."],
  ["Beta Test Agent", "Builds the test plan for websites, apps, AI tools, checkout flows, and launch funnels."],
  ["Risk Agent", "Flags unclear authority, weak fit, overclaiming, and delivery risk."],
  ["Offer Agent", "Packages the work into a paid report, repair sprint, or retainer."],
];

function cleanNumber(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function band(score: number) {
  if (score >= 80) return { label: "Premium", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  if (score >= 60) return { label: "Workable", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" };
  if (score >= 40) return { label: "Nurture", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
  return { label: "Low fit", className: "border-red-500/30 bg-red-500/10 text-red-400" };
}

export default function Bridge() {
  const { toast } = useToast();
  const [functionName, setFunctionName] = useState("Website, app, and AI-tool beta testing");
  const [customerNeed, setCustomerNeed] = useState("Need a website, app, AI tool, checkout flow, or launch funnel tested and improved before serious traffic or paid ads.");
  const [budget, setBudget] = useState("2500");
  const [urgency, setUrgency] = useState("72 hours");
  const [channel, setChannel] = useState("Founder groups, LinkedIn, partner referrals, direct outreach, and request-intake landing pages");

  const result = useMemo(() => {
    const money = cleanNumber(budget);
    const moneyScore = money >= 5000 ? 35 : money >= 2500 ? 28 : money >= 1000 ? 20 : money >= 300 ? 10 : 2;
    const urgentText = urgency.toLowerCase();
    const urgencyScore = urgentText.includes("24") || urgentText.includes("today") ? 18 : urgentText.includes("72") || urgentText.includes("week") ? 12 : 6;
    const clarityScore = customerNeed.trim().length > 110 ? 22 : customerNeed.trim().length > 60 ? 16 : 8;
    const channelScore = channel.trim().length > 40 ? 12 : 6;
    const fitScore = functionName.toLowerCase().includes("test") || functionName.toLowerCase().includes("app") ? 13 : 8;
    const score = clamp(18 + moneyScore + urgencyScore + clarityScore + channelScore + fitScore);
    return {
      score,
      band: band(score),
      report: score >= 80 ? "$997" : score >= 60 ? "$497" : "$297",
      sprint: score >= 80 ? "$3,500-$5,000" : score >= 60 ? "$1,500-$3,000" : "Nurture first",
    };
  }, [budget, channel, customerNeed, functionName, urgency]);

  const prompt = `Run the VIBA Growth Engine workflow.\n\nFunction: ${functionName}\nCustomer need: ${customerNeed}\nBudget signal: ${budget}\nUrgency: ${urgency}\nChannel: ${channel}\nOpportunity score: ${result.score}/100 (${result.band.label})\n\nAgent tasks:\n1. Signal Agent: qualify intent and missing information.\n2. Beta Test Agent: define the test plan.\n3. Risk Agent: flag weak fit, unclear authority, and delivery risk.\n4. Offer Agent: package a paid report, repair sprint, and retainer.\n5. Follow-Up Agent: write professional follow-up scripts.\n\nRules:\n- Do not publicly name, rank, mock, or expose any business.\n- Keep diagnostic findings inside the client workflow.\n- Sell readiness, improvement, and verified demand.\n- Do not make guaranteed revenue claims.`;

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    toast({ title: "Copied", description: "Growth Engine prompt copied." });
  }

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-8 py-8">
        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <Badge className="mb-5 gap-2 border-primary/30 bg-primary/10 text-primary" variant="outline">
                <LockKeyhole className="h-3.5 w-3.5" /> Behind-login main function
              </Badge>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">VIBA Growth Engine</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                A private-by-design advertising and beta-testing workflow. VIBA captures customer demand, qualifies the opportunity, routes the work through specialist AI agents, and converts it into private reports, repair sprints, or monthly launch protection.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/sessions/new"><Button className="gap-2">Start agent session <ArrowRight className="h-4 w-4" /></Button></Link>
                <Button variant="outline" className="gap-2" onClick={copyPrompt}><Copy className="h-4 w-4" /> Copy workflow prompt</Button>
              </div>
            </div>
            <div className="border-t bg-muted/25 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <div className="rounded-2xl border bg-background p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold">Opportunity score</p><p className="text-xs text-muted-foreground">Internal qualification estimate</p></div>
                  <Badge variant="outline" className={result.band.className}>{result.band.label}</Badge>
                </div>
                <div className="text-6xl font-bold tracking-tight">{result.score}<span className="text-2xl text-muted-foreground">/100</span></div>
                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Report offer</p><p className="mt-1 font-semibold">{result.report}</p></div>
                  <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Sprint offer</p><p className="mt-1 font-semibold">{result.sprint}</p></div>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">No guaranteed revenue claims. This score prioritises fit, urgency, clarity, and budget signal.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> Intake model</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor="functionName">Function</Label><Input id="functionName" value={functionName} onChange={(e) => setFunctionName(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="customerNeed">Customer-facing need</Label><Textarea id="customerNeed" rows={5} value={customerNeed} onChange={(e) => setCustomerNeed(e.target.value)} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="budget">Budget signal</Label><Input id="budget" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="urgency">Urgency</Label><Input id="urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="channel">Channel</Label><Textarea id="channel" rows={3} value={channel} onChange={(e) => setChannel(e.target.value)} /></div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4" /> Workflow</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {steps.map((step, index) => (
                  <div key={step} className="flex gap-3 rounded-xl border bg-card p-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</div>
                    <p className="text-sm leading-6 text-muted-foreground">{step}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Agent squad</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {agentCards.map(([name, job]) => (
                  <div key={name} className="rounded-xl border bg-card p-4"><p className="font-semibold">{name}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{job}</p></div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Privacy rules</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex items-start gap-3 rounded-xl border bg-card p-3"><EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>No public naming, ranking, roasting, or exposure board.</p></div>
              <div className="flex items-start gap-3 rounded-xl border bg-card p-3"><ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>Diagnostic findings stay inside the client workflow.</p></div>
              <div className="flex items-start gap-3 rounded-xl border bg-card p-3"><TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><p>The angle is opportunity, readiness, and improvement.</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Session handoff prompt</CardTitle></CardHeader>
            <CardContent><pre className="max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">{prompt}</pre></CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}
