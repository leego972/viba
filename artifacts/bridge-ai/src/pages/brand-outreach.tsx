import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Sparkles, Loader2, Copy, Mail, Send, ExternalLink, Globe,
  Zap, Target, Users, DollarSign, TrendingUp, ArrowRight,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminToken() {
  return localStorage.getItem("viba_admin_token") ?? "";
}

const PARTNER_TARGETS = [
  { id: 1, organization: "OpenAI", category: "AI Provider", website: "https://openai.com", notes: "ChatGPT and GPT-4 API — core VIBA provider. Co-marketing for developer tools.", fit: "high" },
  { id: 2, organization: "Anthropic", category: "AI Provider", website: "https://anthropic.com", notes: "Claude API — core VIBA provider. Developer-focused brand alignment.", fit: "high" },
  { id: 3, organization: "Google DeepMind", category: "AI Provider", website: "https://deepmind.google", notes: "Gemini API — core VIBA provider. Enterprise AI market.", fit: "high" },
  { id: 4, organization: "Perplexity AI", category: "AI Provider", website: "https://perplexity.ai", notes: "Search-augmented AI — unique VIBA integration. Fast-growing developer base.", fit: "high" },
  { id: 5, organization: "Y Combinator", category: "Accelerator / Media", website: "https://ycombinator.com", notes: "Massive startup audience. YC companies are prime VIBA users.", fit: "high" },
  { id: 6, organization: "Hugging Face", category: "AI Platform", website: "https://huggingface.co", notes: "AI developer community. Open-source alignment with VIBA's mission.", fit: "medium" },
  { id: 7, organization: "a16z", category: "VC / Media", website: "https://a16z.com", notes: "a16z crypto and AI newsletter reaches 500K+ tech leaders.", fit: "medium" },
  { id: 8, organization: "The Pragmatic Engineer", category: "Newsletter", website: "https://blog.pragmaticengineer.com", notes: "500K+ senior engineering subscribers. Perfect for VIBA's technical audience.", fit: "high" },
  { id: 9, organization: "Lenny's Newsletter", category: "Newsletter", website: "https://lennysnewsletter.com", notes: "Product managers and founders — prime VIBA target audience.", fit: "medium" },
  { id: 10, organization: "Replit", category: "Developer Platform", website: "https://replit.com", notes: "Existing VIBA integration. Co-marketing opportunity with developer audience.", fit: "high" },
];

interface BriefState {
  contactName: string;
  contactRole: string;
  partnerFit: string;
  integrationIdea: string;
  ask: string;
  audience: string;
  vibaValue: string;
}

export default function BrandOutreachPage() {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [draft, setDraft] = useState("");
  const [brief, setBrief] = useState<BriefState>({
    contactName: "",
    contactRole: "Partnerships",
    partnerFit: "",
    integrationIdea: "",
    ask: "",
    audience: "AI developers and product teams",
    vibaValue: "VIBA connects ChatGPT, Claude, Gemini, and more in one orchestrated AI session — role-based agents, cost tracking, and human-in-the-loop approvals.",
  });

  const filtered = PARTNER_TARGETS.filter(p => {
    const s = search.toLowerCase();
    return !s || p.organization.toLowerCase().includes(s) || p.category.toLowerCase().includes(s) || p.notes.toLowerCase().includes(s);
  });

  const selected = PARTNER_TARGETS.find(p => p.id === selectedId) ?? null;

  async function generate() {
    if (!selected) { toast({ title: "Pick a partner first", variant: "destructive" }); return; }
    if (!brief.partnerFit.trim() || !brief.integrationIdea.trim()) {
      toast({ title: "Fill in partner fit + integration idea", variant: "destructive" }); return;
    }
    setGenerating(true);
    setDraft("");
    try {
      const prompt = `Write a personalized cold-outreach email for a partnership/co-marketing opportunity.

VIBA: ${brief.vibaValue}
Website: https://viba.guru

Partner: ${selected.organization} (${selected.category})
Partner notes: ${selected.notes}
Contact: ${brief.contactName || "[Name]"} (${brief.contactRole})
Audience VIBA reaches: ${brief.audience}
Why this partner fits: ${brief.partnerFit}
Integration/co-marketing idea: ${brief.integrationIdea}
The ask: ${brief.ask || "15-minute discovery call"}

Constraints: ≤180 words, professional but conversational, lead with the VALUE for their audience (not VIBA), include 1 concrete collaboration idea, end with a clear CTA (15-min call). No emojis. Subject line on the first line labeled "Subject: ".`;

      const res = await fetch(`${BASE}/api/seo/llms-txt`, {
        headers: { "Authorization": `Bearer ${getAdminToken()}` },
      });

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are an expert partnership and business development writer. Write concise, value-first outreach emails." },
            { role: "user", content: prompt },
          ],
          max_tokens: 500,
          temperature: 0.7,
        }),
      });

      if (!groqRes.ok) throw new Error("AI generation failed — check GROQ_API_KEY");
      const data = await groqRes.json() as { choices: { message: { content: string } }[] };
      const text = data.choices[0]?.message?.content ?? "";
      setDraft(text);
      toast({ title: "Draft ready!" });
    } catch (err) {
      toast({ title: "Generation failed", description: String(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function copyDraft() {
    navigator.clipboard.writeText(draft);
    toast({ title: "Copied to clipboard" });
  }

  function openMailto() {
    if (!draft || !selected) return;
    const lines = draft.split("\n").filter(l => l.trim());
    const subjectLine = lines.find(l => /^subject:/i.test(l));
    const subject = subjectLine ? subjectLine.replace(/^subject:\s*/i, "") : `Partnership opportunity — VIBA × ${selected.organization}`;
    const body = lines.filter(l => !(/^subject:/i.test(l))).join("\n").trim();
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Building2 className="h-6 w-6 text-amber-400" /> Brand Outreach</h1>
          <p className="text-muted-foreground text-sm mt-1">AI-powered partnership and co-marketing outreach desk for VIBA</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><Target className="h-4 w-4 text-amber-400" /><span className="text-xs text-muted-foreground">Partner Targets</span></div>
              <p className="text-xl font-bold">{PARTNER_TARGETS.length}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><TrendingUp className="h-4 w-4 text-green-400" /><span className="text-xs text-muted-foreground">High-Fit</span></div>
              <p className="text-xl font-bold">{PARTNER_TARGETS.filter(p => p.fit === "high").length}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-blue-400" /><span className="text-xs text-muted-foreground">Categories</span></div>
              <p className="text-xl font-bold">{new Set(PARTNER_TARGETS.map(p => p.category)).size}</p>
            </CardContent>
          </Card>
          <Card className="border-border/50 bg-card/80">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-1"><Zap className="h-4 w-4 text-purple-400" /><span className="text-xs text-muted-foreground">AI-Powered</span></div>
              <p className="text-xl font-bold">∞</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {/* Partner list */}
          <Card className="border-border/50 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Partner Targets</CardTitle>
              <CardDescription>Select a target to draft outreach</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Search partners…" value={search} onChange={e => setSearch(e.target.value)} className="h-8 text-xs" />
              <div className="space-y-1.5 max-h-[500px] overflow-y-auto pr-1">
                {filtered.map(p => (
                  <button key={p.id} onClick={() => setSelectedId(p.id)}
                    className={`w-full text-left p-2.5 rounded-lg border transition-colors ${p.id === selectedId ? "border-amber-400/40 bg-amber-500/5" : "border-border/50 hover:border-border hover:bg-card/80"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{p.organization}</div>
                        <div className="text-xs text-muted-foreground">{p.category}</div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Badge variant="outline" className={`text-[10px] ${p.fit === "high" ? "border-green-500/30 text-green-400" : "border-yellow-500/30 text-yellow-400"}`}>{p.fit}</Badge>
                        {p.website && (
                          <a href={p.website} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}>
                            <ExternalLink className="h-3 w-3 text-muted-foreground" />
                          </a>
                        )}
                      </div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1 line-clamp-2">{p.notes}</p>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Outreach drafter */}
          <Card className="lg:col-span-2 border-border/50 bg-card/80">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-400" /> Outreach Drafter</CardTitle>
              <CardDescription>{selected ? `Drafting for ${selected.organization}` : "Select a partner on the left to start"}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {selected && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-xs space-y-1">
                  <p className="font-semibold text-amber-400">{selected.organization}</p>
                  <p className="text-muted-foreground">{selected.notes}</p>
                </div>
              )}

              <div className="grid md:grid-cols-2 gap-3">
                <div><Label className="text-xs">Contact Name (optional)</Label><Input value={brief.contactName} onChange={e => setBrief(b => ({ ...b, contactName: e.target.value }))} placeholder="Alex Chen" className="h-8 text-xs" /></div>
                <div><Label className="text-xs">Contact Role</Label><Input value={brief.contactRole} onChange={e => setBrief(b => ({ ...b, contactRole: e.target.value }))} className="h-8 text-xs" /></div>
                <div className="md:col-span-2"><Label className="text-xs">Why this partner fits VIBA *</Label>
                  <Textarea value={brief.partnerFit} onChange={e => setBrief(b => ({ ...b, partnerFit: e.target.value }))} rows={2} placeholder="Their developer audience overlaps with VIBA users…" className="text-xs" /></div>
                <div className="md:col-span-2"><Label className="text-xs">Integration / co-marketing idea *</Label>
                  <Textarea value={brief.integrationIdea} onChange={e => setBrief(b => ({ ...b, integrationIdea: e.target.value }))} rows={2} placeholder="Featured in their developer newsletter, joint webinar, native integration…" className="text-xs" /></div>
                <div className="md:col-span-2"><Label className="text-xs">The Ask</Label>
                  <Input value={brief.ask} onChange={e => setBrief(b => ({ ...b, ask: e.target.value }))} placeholder="15-min call, newsletter feature, joint blog post…" className="h-8 text-xs" /></div>
              </div>

              <div className="flex gap-2">
                <Button onClick={generate} disabled={generating || !selected} className="bg-amber-500 hover:bg-amber-600 text-black" size="sm">
                  {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Mail className="h-4 w-4 mr-1" />}
                  Draft Email
                </Button>
                {draft && (
                  <>
                    <Button onClick={copyDraft} variant="outline" size="sm"><Copy className="h-4 w-4 mr-1" /> Copy</Button>
                    <Button onClick={openMailto} variant="outline" size="sm"><Send className="h-4 w-4 mr-1" /> Open in Mail</Button>
                  </>
                )}
              </div>

              {draft && (
                <div className="border border-border/50 rounded-lg p-4 bg-muted/20 space-y-2">
                  <Badge variant="outline" className="text-[10px] text-amber-400 border-amber-500/30">Draft for {selected?.organization}</Badge>
                  <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-foreground/90 max-h-80 overflow-y-auto">{draft}</pre>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </AppLayout>
  );
}
