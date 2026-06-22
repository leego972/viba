import { useMemo, useState } from "react";
import { Link } from "wouter";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import {
  ArrowRight,
  BadgeDollarSign,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  EyeOff,
  LockKeyhole,
  Megaphone,
  ShieldCheck,
  Target,
  TrendingUp,
  Workflow,
} from "lucide-react";

type CardItem = {
  title: string;
  text: string;
};

type OfferItem = {
  price: string;
  name: string;
  purpose: string;
};

type CommandStatus = "Draft" | "Validate" | "Ready" | "Scale";

type ProofGate = {
  title: string;
  state: "Required" | "Ready" | "Strong";
  text: string;
};

const workflowSteps: CardItem[] = [
  { title: "Capture", text: "Record the customer need, buyer trigger, audience, channel, and proof asset before any selling starts." },
  { title: "Score", text: "Measure commercial fit using budget signal, urgency, clarity, proof strength, channel strength, and delivery risk." },
  { title: "Package", text: "Convert the opportunity into a report, repair sprint, retainer, campaign angle, and follow-up path." },
  { title: "Verify", text: "Require proof gates before the work can be treated as ready: intake, offer, proof asset, KPI gate, and private-delivery rule." },
  { title: "Compound", text: "Use each completed job as private proof, an anonymised benchmark, and the next business asset input." },
];

const tribunalSteps: CardItem[] = [
  { title: "Strategist", text: "Defines the business asset, buyer, promised outcome, and first measurable success gate." },
  { title: "Builder", text: "Creates the campaign, report structure, repair scope, and operating checklist." },
  { title: "Tester", text: "Checks whether the flow, offer, proof, and buyer path make practical sense." },
  { title: "Critic", text: "Finds weak claims, vague positioning, unclear authority, and missing conversion evidence." },
  { title: "Risk Officer", text: "Blocks public exposure, unsafe promises, unapproved naming, and anything that could damage trust." },
  { title: "Monetiser", text: "Turns the asset into a clear report, sprint, retainer, referral path, and next campaign." },
  { title: "Verifier", text: "Refuses to mark the asset as ready until the proof gates are satisfied." },
];

const privacyRules: CardItem[] = [
  { title: "No public exposure", text: "No public naming, ranking, roasting, or shame board." },
  { title: "Private diagnostics", text: "Findings stay inside the client workflow unless the owner explicitly approves a case study." },
  { title: "No fake guarantees", text: "Use testable assumptions, scorecards, and conversion gates instead of guaranteed revenue claims." },
  { title: "Permission-based selling", text: "Sell readiness, improvement, verified demand, and business-asset creation." },
];

function cleanNumber(value: string) {
  const parsed = Number(value.replace(/[^0-9.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function scoreBand(score: number) {
  if (score >= 85) return { label: "Scale", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  if (score >= 70) return { label: "Ready", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" };
  if (score >= 50) return { label: "Validate", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
  return { label: "Draft", className: "border-red-500/30 bg-red-500/10 text-red-400" };
}

function statusFromScore(score: number): CommandStatus {
  if (score >= 85) return "Scale";
  if (score >= 70) return "Ready";
  if (score >= 50) return "Validate";
  return "Draft";
}

function gateState(condition: boolean, strongCondition = false): ProofGate["state"] {
  if (strongCondition) return "Strong";
  return condition ? "Ready" : "Required";
}

export default function Bridge() {
  const { toast } = useToast();
  const [functionName, setFunctionName] = useState("Website, app, and AI-tool beta testing");
  const [customerNeed, setCustomerNeed] = useState("Need a website, app, AI tool, checkout flow, or launch funnel tested and improved before serious traffic or paid ads.");
  const [audience, setAudience] = useState("Founders, small business owners, SaaS builders, agencies, creators, and local companies preparing to launch or advertise.");
  const [triggerEvent, setTriggerEvent] = useState("They are about to launch, buy ads, fix a broken build, improve conversions, or recover from poor user feedback.");
  const [budget, setBudget] = useState("2500");
  const [urgency, setUrgency] = useState("72 hours");
  const [channel, setChannel] = useState("Founder groups, LinkedIn, partner referrals, direct outreach, request-intake landing pages, and agency partnerships");
  const [proofAsset, setProofAsset] = useState("Private beta-test scorecard, launch-readiness report, repair sprint plan, QA checklist, and before/after improvement summary.");

  const result = useMemo(() => {
    const money = cleanNumber(budget);
    const moneyScore = money >= 10000 ? 30 : money >= 5000 ? 25 : money >= 2500 ? 20 : money >= 1000 ? 13 : money >= 300 ? 7 : 2;
    const urgentText = urgency.toLowerCase();
    const urgencyScore = urgentText.includes("24") || urgentText.includes("today") ? 15 : urgentText.includes("72") || urgentText.includes("week") ? 11 : 6;
    const clarityScore = customerNeed.trim().length > 110 ? 14 : customerNeed.trim().length > 60 ? 10 : 5;
    const audienceScore = audience.trim().length > 80 ? 10 : 5;
    const triggerScore = triggerEvent.trim().length > 70 ? 10 : 5;
    const proofScore = proofAsset.trim().length > 75 ? 9 : 4;
    const channelScore = channel.trim().length > 65 ? 9 : 5;
    const fitScore = functionName.toLowerCase().includes("test") || functionName.toLowerCase().includes("repair") || functionName.toLowerCase().includes("app") ? 10 : 6;
    const score = clamp(18 + moneyScore + urgencyScore + clarityScore + audienceScore + triggerScore + proofScore + channelScore + fitScore);
    const status = statusFromScore(score);
    return {
      score,
      status,
      band: scoreBand(score),
      report: score >= 85 ? "$997-$1,500" : score >= 70 ? "$497-$997" : "$297-$497",
      sprint: score >= 85 ? "$5,000-$10,000" : score >= 70 ? "$2,500-$5,000" : score >= 50 ? "$1,500-$2,500" : "Rework offer first",
      monthly: score >= 85 ? "$2,500-$5,000/mo" : score >= 70 ? "$997-$2,500/mo" : score >= 50 ? "$497-$997/mo" : "After validation",
      nextAction: score >= 85
        ? "Launch one controlled campaign, one partner referral test, and one direct outreach sequence."
        : score >= 70
        ? "Run the paid beta-test report offer and collect proof before scaling."
        : score >= 50
        ? "Run a seven-day validation sprint before offering repair work."
        : "Tighten the audience, trigger event, proof asset, and offer before selling.",
    };
  }, [audience, budget, channel, customerNeed, functionName, proofAsset, triggerEvent, urgency]);

  const campaignAssets = useMemo(() => {
    const headline = "Before you buy more traffic, make sure your build can convert it.";
    const subheadline = "VIBA privately beta-tests your website, app, or AI tool, finds launch blockers, packages the fix plan, and turns the work into a sellable business asset.";
    const cta = result.score >= 70 ? "Run my private readiness scan" : "Check my launch risk privately";
    const contentHook = "Most businesses do not need more ads first. They need to stop losing the traffic they already paid for.";
    const directOutreach = "I noticed you are building or promoting something that likely depends on a clean user flow. VIBA can run a private beta-test and launch-readiness workflow before you spend more on traffic. No public report, no shame board, just a practical scorecard and fix plan.";
    return { headline, subheadline, cta, contentHook, directOutreach };
  }, [result.score]);

  const proofGates: ProofGate[] = [
    {
      title: "Buyer problem defined",
      state: gateState(customerNeed.trim().length > 60, customerNeed.trim().length > 110),
      text: "The need must be specific enough to sell without guessing.",
    },
    {
      title: "Buyer trigger identified",
      state: gateState(triggerEvent.trim().length > 50, triggerEvent.trim().length > 80),
      text: "A trigger event makes outreach timely instead of random.",
    },
    {
      title: "Proof asset attached",
      state: gateState(proofAsset.trim().length > 55, proofAsset.trim().length > 90),
      text: "Every sale needs a scorecard, report, checklist, benchmark, or before/after proof.",
    },
    {
      title: "Revenue path priced",
      state: gateState(cleanNumber(budget) >= 300, cleanNumber(budget) >= 2500),
      text: "The offer must be worth the operational cost of testing, repairing, and supporting it.",
    },
    {
      title: "Private delivery rule",
      state: "Strong",
      text: "No public exposure, no shame board, no unapproved naming. Trust is part of the product.",
    },
  ];

  const offerLadder: OfferItem[] = [
    { price: "$0-$97", name: "Private readiness snapshot", purpose: "Low-friction entry that captures demand and proves the private diagnostic value." },
    { price: result.report, name: "Paid beta-test report", purpose: "A structured QA, UX, trust, mobile, payment/contact, and launch-blocker report." },
    { price: result.sprint, name: "Repair sprint", purpose: "Done-for-you or done-with-you fixes, deployment checks, and conversion-readiness improvements." },
    { price: result.monthly, name: "Launch protection retainer", purpose: "Ongoing QA, release testing, regression checks, follow-up campaigns, and private benchmarks." },
  ];

  const assetRecord = {
    name: functionName || "Untitled business asset",
    status: result.status,
    buyer: audience,
    nextAction: result.nextAction,
    revenuePath: `${result.report} report → ${result.sprint} sprint → ${result.monthly} retainer`,
  };

  const prompt = `Run the VIBA Asset Growth Engine.

VIBA meaning: Very Interesting Business Assets.
Asset: ${assetRecord.name}
Status: ${assetRecord.status}
Customer need: ${customerNeed}
Audience: ${audience}
Trigger event: ${triggerEvent}
Budget signal: ${budget}
Urgency: ${urgency}
Channel: ${channel}
Proof asset: ${proofAsset}
Opportunity score: ${result.score}/100 (${result.band.label})
Next best action: ${result.nextAction}
Revenue path: ${assetRecord.revenuePath}

Generated campaign assets:
Headline: ${campaignAssets.headline}
Subheadline: ${campaignAssets.subheadline}
CTA: ${campaignAssets.cta}
Content hook: ${campaignAssets.contentHook}
Direct outreach: ${campaignAssets.directOutreach}

Proof gates:
${proofGates.map((gate, index) => `${index + 1}. ${gate.title}: ${gate.state} — ${gate.text}`).join("\n")}

Agent tribunal:
${tribunalSteps.map((step, index) => `${index + 1}. ${step.title}: ${step.text}`).join("\n")}

Rules:
- Do not publicly name, rank, mock, or expose any business.
- Keep diagnostic findings inside the client workflow unless permission is granted.
- Turn useful opportunities into sellable business assets.
- Use conversion assumptions and KPI gates, not guaranteed revenue claims.
- Do not mark the asset ready unless proof gates are satisfied.
- Prefer practical campaign experiments over theory.`;

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    toast({ title: "Copied", description: "VIBA asset command prompt copied." });
  }

  async function copyCampaign() {
    const text = `Headline: ${campaignAssets.headline}\nSubheadline: ${campaignAssets.subheadline}\nCTA: ${campaignAssets.cta}\nHook: ${campaignAssets.contentHook}\nOutreach: ${campaignAssets.directOutreach}`;
    await navigator.clipboard.writeText(text);
    toast({ title: "Copied", description: "Campaign assets copied." });
  }

  return (
    <AppLayout>
      <div className="mx-auto flex max-w-7xl flex-col gap-8 py-8">
        <section className="overflow-hidden rounded-3xl border bg-card shadow-sm">
          <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <Badge className="mb-5 gap-2 border-primary/30 bg-primary/10 text-primary" variant="outline">
                <LockKeyhole className="h-3.5 w-3.5" /> Very Interesting Business Assets
              </Badge>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">VIBA Asset Growth Engine</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                A clean operating system for turning buyer demand into a verified, monetisable business asset. One page. One score. One next action. No public exposure.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/sessions/new"><Button className="gap-2">Start agent session <ArrowRight className="h-4 w-4" /></Button></Link>
                <Button variant="outline" className="gap-2" onClick={copyPrompt}><Copy className="h-4 w-4" /> Copy command prompt</Button>
                <Button variant="outline" className="gap-2" onClick={copyCampaign}><Megaphone className="h-4 w-4" /> Copy campaign assets</Button>
              </div>
            </div>
            <div className="border-t bg-muted/25 p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-10">
              <div className="rounded-2xl border bg-background p-5">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div><p className="text-sm font-semibold">Asset opportunity score</p><p className="text-xs text-muted-foreground">Fit, urgency, proof, channel, and monetisation strength</p></div>
                  <Badge variant="outline" className={result.band.className}>{result.band.label}</Badge>
                </div>
                <div className="text-6xl font-bold tracking-tight">{result.score}<span className="text-2xl text-muted-foreground">/100</span></div>
                <div className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
                  <Metric label="Report" value={result.report} />
                  <Metric label="Sprint" value={result.sprint} />
                  <Metric label="Retainer" value={result.monthly} />
                </div>
                <div className="mt-4 rounded-xl border bg-primary/5 p-3">
                  <p className="text-xs font-semibold text-foreground">Next best action</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{result.nextAction}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> Asset intake</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor="functionName">Business asset</Label><Input id="functionName" value={functionName} onChange={(e) => setFunctionName(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="customerNeed">Customer need</Label><Textarea id="customerNeed" rows={4} value={customerNeed} onChange={(e) => setCustomerNeed(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="audience">Buyer / audience</Label><Textarea id="audience" rows={3} value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="triggerEvent">Buyer trigger</Label><Textarea id="triggerEvent" rows={3} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} /></div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2"><Label htmlFor="budget">Budget signal</Label><Input id="budget" value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
                <div className="space-y-2"><Label htmlFor="urgency">Urgency</Label><Input id="urgency" value={urgency} onChange={(e) => setUrgency(e.target.value)} /></div>
              </div>
              <div className="space-y-2"><Label htmlFor="channel">Channel mix</Label><Textarea id="channel" rows={3} value={channel} onChange={(e) => setChannel(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="proofAsset">Proof asset</Label><Textarea id="proofAsset" rows={3} value={proofAsset} onChange={(e) => setProofAsset(e.target.value)} /></div>
            </CardContent>
          </Card>

          <div className="grid gap-6">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ClipboardCheck className="h-4 w-4" /> Asset ledger</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <AssetRow label="Asset" value={assetRecord.name} />
                <AssetRow label="Status" value={`${assetRecord.status} — ${result.score}/100`} />
                <AssetRow label="Revenue path" value={assetRecord.revenuePath} />
                <AssetRow label="Next action" value={assetRecord.nextAction} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Proof engine</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                {proofGates.map((gate) => (
                  <ProofGateRow key={gate.title} gate={gate} />
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4" /> Campaign assets</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <AssetRow label="Headline" value={campaignAssets.headline} />
              <AssetRow label="Subheadline" value={campaignAssets.subheadline} />
              <AssetRow label="CTA" value={campaignAssets.cta} />
              <AssetRow label="Content hook" value={campaignAssets.contentHook} />
              <AssetRow label="Direct outreach" value={campaignAssets.directOutreach} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeDollarSign className="h-4 w-4" /> Revenue path</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {offerLadder.map((offer) => (
                <div key={offer.name} className="rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-3"><p className="font-semibold">{offer.name}</p><Badge variant="outline">{offer.price}</Badge></div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{offer.purpose}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4" /> Operating loop</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {workflowSteps.map((step, index) => (
                <NumberedRow key={step.title} index={index} title={step.title} text={step.text} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Agent tribunal</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {tribunalSteps.map((step, index) => (
                <NumberedRow key={step.title} index={index} title={step.title} text={step.text} />
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><EyeOff className="h-4 w-4" /> Trust rules</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {privacyRules.map((rule, index) => (
                <div key={rule.title} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                  {index === 0 ? <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  <div><p className="font-medium text-foreground">{rule.title}</p><p className="leading-6">{rule.text}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> VIBA command prompt</CardTitle></CardHeader>
            <CardContent><pre className="max-h-[420px] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">{prompt}</pre></CardContent>
          </Card>
        </section>
      </div>
    </AppLayout>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}

function AssetRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6">{value}</p>
    </div>
  );
}

function NumberedRow({ index, title, text }: { index: number; title: string; text: string }) {
  return (
    <div className="flex gap-3 rounded-xl border bg-card p-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</div>
      <div><p className="font-medium">{title}</p><p className="text-sm leading-6 text-muted-foreground">{text}</p></div>
    </div>
  );
}

function ProofGateRow({ gate }: { gate: ProofGate }) {
  const className = gate.state === "Strong"
    ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
    : gate.state === "Ready"
    ? "border-blue-500/30 bg-blue-500/10 text-blue-400"
    : "border-amber-500/30 bg-amber-500/10 text-amber-400";

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="font-semibold">{gate.title}</p>
        <Badge variant="outline" className={className}>{gate.state}</Badge>
      </div>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{gate.text}</p>
    </div>
  );
}
