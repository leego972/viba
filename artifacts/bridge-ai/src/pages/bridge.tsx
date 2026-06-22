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

const workflowSteps: CardItem[] = [
  { title: "Demand capture", text: "Advertise the buyer need and collect private request details without exposing any business publicly." },
  { title: "Qualification", text: "Score urgency, budget signal, buyer clarity, channel fit, proof strength, and delivery risk." },
  { title: "Asset packaging", text: "Turn the opportunity into a report, sprint, retainer, partner handoff, campaign, and follow-up sequence." },
  { title: "Agent execution", text: "Route the work through VIBA agents for beta testing, risk review, offer creation, campaign copy, and close support." },
  { title: "Feedback loop", text: "Use every completed job as private proof, anonymised benchmark insight, and the next campaign input." },
];

const agentCards: CardItem[] = [
  { title: "Signal Agent", text: "Qualifies buyer intent, urgency, budget signal, channel fit, and missing information." },
  { title: "Beta Test Agent", text: "Builds the test plan for websites, apps, AI tools, checkout flows, onboarding, and launch funnels." },
  { title: "Risk Agent", text: "Flags unclear authority, weak fit, delivery risk, overclaiming, and anything that should not be sold." },
  { title: "Offer Agent", text: "Packages the work into a paid report, repair sprint, monthly protection plan, or partner handoff." },
  { title: "Campaign Agent", text: "Creates headline angles, ad copy, organic posts, referral hooks, and direct outreach sequences." },
  { title: "Proof Agent", text: "Converts outcomes into private proof assets, anonymised benchmarks, and safe case-study structures." },
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
  if (score >= 85) return { label: "Scale now", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" };
  if (score >= 70) return { label: "Strong", className: "border-blue-500/30 bg-blue-500/10 text-blue-400" };
  if (score >= 50) return { label: "Prove first", className: "border-amber-500/30 bg-amber-500/10 text-amber-400" };
  return { label: "Rework", className: "border-red-500/30 bg-red-500/10 text-red-400" };
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
    return {
      score,
      band: scoreBand(score),
      report: score >= 85 ? "$997-$1,500" : score >= 70 ? "$497-$997" : "$297-$497",
      sprint: score >= 85 ? "$5,000-$10,000" : score >= 70 ? "$2,500-$5,000" : score >= 50 ? "$1,500-$2,500" : "Rework offer first",
      monthly: score >= 85 ? "$2,500-$5,000/mo" : score >= 70 ? "$997-$2,500/mo" : score >= 50 ? "$497-$997/mo" : "After validation",
      experiment: score >= 70 ? "Launch controlled campaign now" : "Run 7-day validation sprint first",
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

  const offerLadder: OfferItem[] = [
    { price: "$0-$97", name: "Private readiness snapshot", purpose: "Low-friction entry that captures demand and proves the private diagnostic value." },
    { price: result.report, name: "Paid beta-test report", purpose: "A structured QA, UX, trust, mobile, payment/contact, and launch-blocker report." },
    { price: result.sprint, name: "Repair sprint", purpose: "Done-for-you or done-with-you fixes, deployment checks, and conversion-readiness improvements." },
    { price: result.monthly, name: "Launch protection retainer", purpose: "Ongoing QA, release testing, regression checks, follow-up campaigns, and private benchmarks." },
  ];

  const experiments: CardItem[] = [
    { title: "Traffic readiness ad", text: "Target businesses about to spend on ads: 'Check your site before you buy traffic.'" },
    { title: "Founder rescue angle", text: "Target builders with bugs, launch pressure, or incomplete AI tools: 'Get a private fix plan.'" },
    { title: "Agency partner loop", text: "Offer agencies a private QA layer they can resell before client launches." },
    { title: "Referral bounty", text: "Reward trusted partners for sending qualified builds needing beta testing or launch repair." },
  ];

  const prompt = `Run the VIBA Asset Growth Engine.\n\nVIBA meaning: Very Interesting Business Assets.\nFunction: ${functionName}\nCustomer need: ${customerNeed}\nAudience: ${audience}\nTrigger event: ${triggerEvent}\nBudget signal: ${budget}\nUrgency: ${urgency}\nChannel: ${channel}\nProof asset: ${proofAsset}\nOpportunity score: ${result.score}/100 (${result.band.label})\n\nGenerated campaign assets:\nHeadline: ${campaignAssets.headline}\nSubheadline: ${campaignAssets.subheadline}\nCTA: ${campaignAssets.cta}\nContent hook: ${campaignAssets.contentHook}\nDirect outreach: ${campaignAssets.directOutreach}\n\nOffer ladder:\n1. Private readiness snapshot: $0-$97\n2. Paid beta-test report: ${result.report}\n3. Repair sprint: ${result.sprint}\n4. Launch protection retainer: ${result.monthly}\n\nAgent tasks:\n1. Signal Agent: qualify intent, authority, urgency, budget strength, and missing information.\n2. Beta Test Agent: create the beta-test and launch-readiness test plan.\n3. Risk Agent: flag weak fit, unclear authority, overclaiming, and delivery risk.\n4. Campaign Agent: create three paid ad angles, three organic post angles, one direct outreach script, and one referral partner pitch.\n5. Offer Agent: package the report, sprint, retainer, and close script.\n6. Proof Agent: create private proof assets and anonymised benchmark insights without exposing the business.\n\nRules:\n- Do not publicly name, rank, mock, or expose any business.\n- Keep diagnostic findings inside the client workflow unless permission is granted.\n- Turn useful opportunities into sellable business assets.\n- Use conversion assumptions and KPI gates, not guaranteed revenue claims.\n- Prefer practical campaign experiments over theory.`;

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    toast({ title: "Copied", description: "Advanced VIBA Growth Engine prompt copied." });
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
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="p-6 sm:p-8 lg:p-10">
              <Badge className="mb-5 gap-2 border-primary/30 bg-primary/10 text-primary" variant="outline">
                <LockKeyhole className="h-3.5 w-3.5" /> Very Interesting Business Assets
              </Badge>
              <h1 className="max-w-3xl text-3xl font-bold tracking-tight sm:text-5xl">VIBA Asset Growth Engine</h1>
              <p className="mt-5 max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                An advanced private advertising, beta-testing, and business-asset operating system. It captures buyer demand, scores the opportunity, generates campaigns, builds the offer ladder, and hands execution to VIBA agents.
              </p>
              <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                <Link href="/sessions/new"><Button className="gap-2">Start agent session <ArrowRight className="h-4 w-4" /></Button></Link>
                <Button variant="outline" className="gap-2" onClick={copyPrompt}><Copy className="h-4 w-4" /> Copy full agent prompt</Button>
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
                  <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Report</p><p className="mt-1 font-semibold">{result.report}</p></div>
                  <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Sprint</p><p className="mt-1 font-semibold">{result.sprint}</p></div>
                  <div className="rounded-xl border bg-card p-3"><p className="text-xs text-muted-foreground">Retainer</p><p className="mt-1 font-semibold">{result.monthly}</p></div>
                </div>
                <p className="mt-4 text-xs leading-5 text-muted-foreground">No guaranteed revenue claims. Effectiveness comes from scoring, experiments, offer fit, follow-up, and measurable conversion gates.</p>
              </div>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Target className="h-4 w-4" /> Asset intake model</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label htmlFor="functionName">Business asset function</Label><Input id="functionName" value={functionName} onChange={(e) => setFunctionName(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="customerNeed">Customer-facing need</Label><Textarea id="customerNeed" rows={4} value={customerNeed} onChange={(e) => setCustomerNeed(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="audience">Target audience</Label><Textarea id="audience" rows={3} value={audience} onChange={(e) => setAudience(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="triggerEvent">Buyer trigger event</Label><Textarea id="triggerEvent" rows={3} value={triggerEvent} onChange={(e) => setTriggerEvent(e.target.value)} /></div>
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
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Megaphone className="h-4 w-4" /> Generated campaign assets</CardTitle></CardHeader>
              <CardContent className="grid gap-3">
                <AssetRow label="Headline" value={campaignAssets.headline} />
                <AssetRow label="Subheadline" value={campaignAssets.subheadline} />
                <AssetRow label="CTA" value={campaignAssets.cta} />
                <AssetRow label="Content hook" value={campaignAssets.contentHook} />
                <AssetRow label="Direct outreach" value={campaignAssets.directOutreach} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2 text-base"><BadgeDollarSign className="h-4 w-4" /> Offer ladder</CardTitle></CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">
                {offerLadder.map((offer) => (
                  <div key={offer.name} className="rounded-xl border bg-card p-4">
                    <div className="flex items-start justify-between gap-3"><p className="font-semibold">{offer.name}</p><Badge variant="outline">{offer.price}</Badge></div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{offer.purpose}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Workflow className="h-4 w-4" /> Operating loop</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              {workflowSteps.map((step, index) => (
                <div key={step.title} className="flex gap-3 rounded-xl border bg-card p-3">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{index + 1}</div>
                  <div><p className="font-medium">{step.title}</p><p className="text-sm leading-6 text-muted-foreground">{step.text}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><TrendingUp className="h-4 w-4" /> Experiments to run</CardTitle></CardHeader>
            <CardContent className="grid gap-3">
              <div className="rounded-xl border bg-primary/5 p-4"><p className="text-sm font-semibold">Recommended next action</p><p className="mt-1 text-sm text-muted-foreground">{result.experiment}</p></div>
              {experiments.map((experiment) => (
                <div key={experiment.title} className="rounded-xl border bg-card p-4"><p className="font-semibold">{experiment.title}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{experiment.text}</p></div>
              ))}
            </CardContent>
          </Card>
        </section>

        <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Agent squad</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              {agentCards.map((agent) => (
                <div key={agent.title} className="rounded-xl border bg-card p-4"><p className="font-semibold">{agent.title}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{agent.text}</p></div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><ShieldCheck className="h-4 w-4" /> Privacy and trust rules</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {privacyRules.map((rule, index) => (
                <div key={rule.title} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                  {index === 0 ? <EyeOff className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> : <ClipboardCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />}
                  <div><p className="font-medium text-foreground">{rule.title}</p><p className="leading-6">{rule.text}</p></div>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2 text-base"><CheckCircle2 className="h-4 w-4" /> Full VIBA agent handoff prompt</CardTitle></CardHeader>
          <CardContent><pre className="max-h-[380px] overflow-auto whitespace-pre-wrap rounded-xl border bg-muted/30 p-4 text-xs leading-6 text-muted-foreground">{prompt}</pre></CardContent>
        </Card>
      </div>
    </AppLayout>
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
