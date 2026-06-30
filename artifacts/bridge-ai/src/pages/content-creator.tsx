import { useState, useEffect } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  PenTool, Sparkles, Plus, RefreshCw, CheckCircle, XCircle, Eye,
  BarChart3, Zap, Camera, Briefcase, Globe, Mail, BookOpen,
  Clock, Copy, Trash2, Play, AlertCircle, Video, Hash,
  FileText, Star, MessageSquare, Send, Loader2, Users,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function getAdminToken() {
  return localStorage.getItem("viba_admin_token") ?? "";
}

async function api(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, {
    ...opts,
    headers: { "Authorization": `Bearer ${getAdminToken()}`, "Content-Type": "application/json", ...opts?.headers },
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  return res.json();
}

const PLATFORM_META: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  tiktok: { label: "TikTok", color: "text-pink-400", bg: "bg-pink-500/10 border-pink-500/20", icon: <Video className="h-4 w-4" /> },
  instagram: { label: "Instagram", color: "text-purple-400", bg: "bg-purple-500/10 border-purple-500/20", icon: <Camera className="h-4 w-4" /> },
  x_twitter: { label: "X (Twitter)", color: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/20", icon: <MessageSquare className="h-4 w-4" /> },
  linkedin: { label: "LinkedIn", color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20", icon: <Briefcase className="h-4 w-4" /> },
  facebook: { label: "Facebook", color: "text-blue-500", bg: "bg-blue-600/10 border-blue-600/20", icon: <Globe className="h-4 w-4" /> },
  youtube_shorts: { label: "YouTube Shorts", color: "text-red-400", bg: "bg-red-500/10 border-red-500/20", icon: <Video className="h-4 w-4" /> },
  blog: { label: "Blog", color: "text-green-400", bg: "bg-green-500/10 border-green-500/20", icon: <BookOpen className="h-4 w-4" /> },
  email: { label: "Email", color: "text-yellow-400", bg: "bg-yellow-500/10 border-yellow-500/20", icon: <Mail className="h-4 w-4" /> },
  reddit: { label: "Reddit", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", icon: <MessageSquare className="h-4 w-4" /> },
  discord: { label: "Discord", color: "text-indigo-400", bg: "bg-indigo-500/10 border-indigo-500/20", icon: <MessageSquare className="h-4 w-4" /> },
  medium: { label: "Medium", color: "text-zinc-300", bg: "bg-gray-500/10 border-gray-500/20", icon: <BookOpen className="h-4 w-4" /> },
};

const STATUS_META: Record<string, { label: string; color: string }> = {
  draft: { label: "Draft", color: "border-zinc-500/30 text-zinc-400" },
  approved: { label: "Approved", color: "border-green-500/30 text-green-400" },
  scheduled: { label: "Scheduled", color: "border-blue-500/30 text-blue-400" },
  published: { label: "Published", color: "border-emerald-500/30 text-emerald-400" },
  archived: { label: "Archived", color: "border-zinc-500/20 text-zinc-500" },
};

const PLATFORMS = ["linkedin", "x_twitter", "reddit", "blog", "email", "medium", "discord", "instagram", "tiktok", "youtube_shorts"];
const CONTENT_TYPES = [
  { value: "social_post", label: "Social Post" },
  { value: "blog_article", label: "Blog Article" },
  { value: "video_script", label: "Video Script" },
  { value: "email_campaign", label: "Email Campaign" },
  { value: "ad_copy", label: "Ad Copy" },
  { value: "thread", label: "Thread" },
];

export default function ContentCreatorPage() {
  const { toast } = useToast();
  const [dashboard, setDashboard] = useState<any>(null);
  const [pieces, setPieces] = useState<any[]>([]);
  const [piecesTotal, setPiecesTotal] = useState(0);
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [running, setRunning] = useState(false);
  const [showNewCampaign, setShowNewCampaign] = useState(false);

  const [genForm, setGenForm] = useState({ platform: "linkedin", contentType: "social_post", topic: "", campaignObjective: "", seoKeywords: "" });
  const [generatedPiece, setGeneratedPiece] = useState<any>(null);
  const [campaignForm, setCampaignForm] = useState({ name: "", description: "", objective: "", targetAudience: "", platforms: "linkedin,x_twitter,reddit" });

  async function loadAll() {
    setLoading(true);
    try {
      const [dash, pcs, camps] = await Promise.all([
        api("/api/content-creator/dashboard"),
        api("/api/content-creator/pieces?limit=20"),
        api("/api/content-creator/campaigns?limit=10"),
      ]);
      setDashboard(dash);
      setPieces(pcs.pieces ?? []); setPiecesTotal(pcs.total ?? 0);
      setCampaigns(camps.campaigns ?? []);
    } catch (err) {
      toast({ title: "Load failed", description: String(err), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function generate() {
    setGenerating(true);
    setGeneratedPiece(null);
    try {
      const r = await api("/api/content-creator/generate", {
        method: "POST",
        body: JSON.stringify({
          platform: genForm.platform,
          contentType: genForm.contentType,
          topic: genForm.topic || undefined,
          campaignObjective: genForm.campaignObjective || undefined,
          seoKeywords: genForm.seoKeywords ? genForm.seoKeywords.split(",").map(s => s.trim()) : [],
          saveToDb: true,
        }),
      });
      setGeneratedPiece(r);
      toast({ title: "Content generated!", description: `Quality: ${r.qualityScore}/100 · SEO: ${r.seoScore}/100` });
      await loadAll();
    } catch (err) {
      toast({ title: "Generation failed", description: String(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function runCycle() {
    setRunning(true);
    try {
      const r = await api("/api/content-creator/autonomous-cycle", {
        method: "POST",
        body: JSON.stringify({ maxPiecesPerPlatform: 2, autoApproveThreshold: 75, autoSchedule: false }),
      });
      toast({ title: "Cycle complete", description: `Generated ${r.generated} pieces` });
      await loadAll();
    } catch (err) {
      toast({ title: "Cycle failed", description: String(err), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  async function updatePieceStatus(id: number, status: string) {
    try {
      await api(`/api/content-creator/pieces/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      toast({ title: `Marked as ${status}` });
      await loadAll();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
  }

  async function createCampaign() {
    try {
      const r = await api("/api/content-creator/campaigns", {
        method: "POST",
        body: JSON.stringify({
          ...campaignForm,
          platforms: campaignForm.platforms.split(",").map(s => s.trim()),
        }),
      });
      toast({ title: "Campaign created", description: `ID: ${r.id}` });
      setShowNewCampaign(false);
      setCampaignForm({ name: "", description: "", objective: "", targetAudience: "", platforms: "linkedin,x_twitter,reddit" });
      await loadAll();
    } catch (err) {
      toast({ title: "Error", description: String(err), variant: "destructive" });
    }
  }

  useEffect(() => { loadAll(); }, []);

  if (loading) return (
    <AppLayout>
      <div className="flex items-center justify-center h-64"><Loader2 className="h-8 w-8 animate-spin text-amber-400" /></div>
    </AppLayout>
  );

  return (
    <AppLayout>
      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2"><PenTool className="h-6 w-6 text-amber-400" /> Content Creator</h1>
            <p className="text-muted-foreground text-sm mt-1">AI-powered multi-platform content generation studio</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={loadAll}><RefreshCw className="h-4 w-4 mr-1" /> Refresh</Button>
            <Button size="sm" onClick={runCycle} disabled={running} className="bg-amber-500 hover:bg-amber-600 text-black">
              {running ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Zap className="h-4 w-4 mr-1" />} Auto-Cycle
            </Button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Campaigns", value: dashboard?.totalCampaigns ?? 0, icon: <BarChart3 className="h-4 w-4" /> },
            { label: "Total Pieces", value: dashboard?.totalPieces ?? 0, icon: <FileText className="h-4 w-4" />, color: "text-blue-400" },
            { label: "Draft", value: dashboard?.draftPieces ?? 0, icon: <AlertCircle className="h-4 w-4" />, color: "text-zinc-400" },
            { label: "Scheduled", value: dashboard?.scheduledPieces ?? 0, icon: <Clock className="h-4 w-4" />, color: "text-blue-400" },
            { label: "Published", value: dashboard?.publishedPieces ?? 0, icon: <CheckCircle className="h-4 w-4" />, color: "text-green-400" },
          ].map(({ label, value, icon, color = "text-amber-400" }) => (
            <Card key={label} className="border-border/50 bg-card/80">
              <CardContent className="p-3">
                <div className="flex items-center gap-2 mb-1"><span className={color}>{icon}</span><span className="text-xs text-muted-foreground">{label}</span></div>
                <p className="text-xl font-bold">{value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Tabs defaultValue="studio">
          <TabsList>
            <TabsTrigger value="studio">Content Studio</TabsTrigger>
            <TabsTrigger value="queue">Content Queue ({piecesTotal})</TabsTrigger>
            <TabsTrigger value="campaigns">Campaigns ({campaigns.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="studio" className="mt-4">
            <div className="grid md:grid-cols-2 gap-4">
              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-amber-400" /> Generate Content</CardTitle></CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Platform</Label>
                      <Select value={genForm.platform} onValueChange={v => setGenForm(f => ({ ...f, platform: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PLATFORMS.map(p => (
                            <SelectItem key={p} value={p}>{PLATFORM_META[p]?.label ?? p}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Content Type</Label>
                      <Select value={genForm.contentType} onValueChange={v => setGenForm(f => ({ ...f, contentType: v }))}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CONTENT_TYPES.map(ct => <SelectItem key={ct.value} value={ct.value}>{ct.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs">Topic / Hook</Label>
                    <Input value={genForm.topic} onChange={e => setGenForm(f => ({ ...f, topic: e.target.value }))} placeholder="e.g. Why multi-agent AI beats single models" className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">Campaign Objective</Label>
                    <Input value={genForm.campaignObjective} onChange={e => setGenForm(f => ({ ...f, campaignObjective: e.target.value }))} placeholder="e.g. drive signups, brand awareness" className="h-8 text-xs" />
                  </div>
                  <div>
                    <Label className="text-xs">SEO Keywords (comma-separated)</Label>
                    <Input value={genForm.seoKeywords} onChange={e => setGenForm(f => ({ ...f, seoKeywords: e.target.value }))} placeholder="AI orchestration, multi-agent AI" className="h-8 text-xs" />
                  </div>
                  <Button onClick={generate} disabled={generating} className="w-full bg-amber-500 hover:bg-amber-600 text-black">
                    {generating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
                    Generate Content
                  </Button>
                </CardContent>
              </Card>

              <Card>
                <CardHeader><CardTitle className="text-base flex items-center gap-2"><Eye className="h-4 w-4 text-blue-400" /> Preview</CardTitle></CardHeader>
                <CardContent>
                  {!generatedPiece ? (
                    <div className="flex flex-col items-center justify-center h-48 text-muted-foreground space-y-2">
                      <PenTool className="h-8 w-8 opacity-30" />
                      <p className="text-sm">Generated content will appear here</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          <Badge variant="outline" className="text-xs text-green-400 border-green-500/30">SEO: {generatedPiece.seoScore}/100</Badge>
                          <Badge variant="outline" className="text-xs text-blue-400 border-blue-500/30">Quality: {generatedPiece.qualityScore}/100</Badge>
                        </div>
                        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => navigator.clipboard.writeText(generatedPiece.body ?? "")}>
                          <Copy className="h-3 w-3 mr-1" /> Copy
                        </Button>
                      </div>
                      {generatedPiece.headline && <p className="font-bold text-sm">{generatedPiece.headline}</p>}
                      {generatedPiece.hook && <p className="text-xs text-amber-400 italic">Hook: {generatedPiece.hook}</p>}
                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{generatedPiece.body}</p>
                      {generatedPiece.callToAction && <p className="text-xs font-medium text-amber-400">CTA: {generatedPiece.callToAction}</p>}
                      {Array.isArray(generatedPiece.hashtags) && generatedPiece.hashtags.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {generatedPiece.hashtags.slice(0, 8).map((tag: string, i: number) => (
                            <span key={i} className="text-[10px] text-amber-400/70">{tag}</span>
                          ))}
                        </div>
                      )}
                      {generatedPiece.generationMs && (
                        <p className="text-[10px] text-muted-foreground">Generated in {generatedPiece.generationMs}ms · Saved as draft</p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="queue" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Content Queue</CardTitle>
                  <div className="flex gap-1">
                    {["draft", "approved", "scheduled", "published"].map(s => (
                      <Button key={s} variant="ghost" size="sm" className="h-7 text-xs capitalize" onClick={async () => {
                        try { const r = await api(`/api/content-creator/pieces?status=${s}&limit=20`); setPieces(r.pieces ?? []); setPiecesTotal(r.total ?? 0); } catch {}
                      }}>{s}</Button>
                    ))}
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={loadAll}>All</Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {pieces.length === 0 ? (
                  <div className="text-center py-10 space-y-3">
                    <FileText className="h-10 w-10 text-muted-foreground mx-auto opacity-30" />
                    <p className="text-muted-foreground">No content pieces yet. Use the Studio to generate some.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {pieces.map((piece: any) => {
                      const pm = PLATFORM_META[piece.platform] ?? { label: piece.platform, color: "text-zinc-400", bg: "", icon: <Globe className="h-4 w-4" /> };
                      const sm = STATUS_META[piece.status] ?? { label: piece.status, color: "border-zinc-500/30 text-zinc-400" };
                      return (
                        <div key={piece.id} className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className={pm.color}>{pm.icon}</span>
                              <span className="text-xs text-muted-foreground">{pm.label}</span>
                              <Badge variant="outline" className={`text-xs ${sm.color}`}>{sm.label}</Badge>
                              {piece.qualityScore > 0 && <span className="text-xs text-amber-400">★ {piece.qualityScore}/100</span>}
                            </div>
                            <div className="flex gap-1 shrink-0">
                              {piece.status === "draft" && (
                                <>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-green-400 px-2" onClick={() => updatePieceStatus(piece.id, "approved")}>
                                    <CheckCircle className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 text-xs text-red-400 px-2" onClick={() => updatePieceStatus(piece.id, "archived")}>
                                    <XCircle className="h-3 w-3" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </div>
                          {piece.headline && <p className="font-semibold text-sm">{piece.headline}</p>}
                          {piece.body && <p className="text-xs text-muted-foreground line-clamp-2">{piece.body}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="campaigns" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Campaigns</CardTitle>
                  <Button size="sm" variant="outline" onClick={() => setShowNewCampaign(!showNewCampaign)}>
                    <Plus className="h-4 w-4 mr-1" /> New Campaign
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {showNewCampaign && (
                  <div className="p-4 rounded-lg border border-border/50 bg-card/50 space-y-3">
                    <p className="text-sm font-semibold">New Campaign</p>
                    <div className="grid grid-cols-2 gap-3">
                      <div><Label className="text-xs">Name *</Label><Input value={campaignForm.name} onChange={e => setCampaignForm(f => ({ ...f, name: e.target.value }))} className="h-8 text-xs" /></div>
                      <div><Label className="text-xs">Objective</Label><Input value={campaignForm.objective} onChange={e => setCampaignForm(f => ({ ...f, objective: e.target.value }))} className="h-8 text-xs" placeholder="brand awareness, signups…" /></div>
                      <div className="col-span-2"><Label className="text-xs">Target Audience</Label><Input value={campaignForm.targetAudience} onChange={e => setCampaignForm(f => ({ ...f, targetAudience: e.target.value }))} className="h-8 text-xs" placeholder="AI developers, startup founders…" /></div>
                      <div className="col-span-2"><Label className="text-xs">Description</Label><Textarea value={campaignForm.description} onChange={e => setCampaignForm(f => ({ ...f, description: e.target.value }))} rows={2} className="text-xs" /></div>
                      <div className="col-span-2"><Label className="text-xs">Platforms (comma-separated)</Label><Input value={campaignForm.platforms} onChange={e => setCampaignForm(f => ({ ...f, platforms: e.target.value }))} className="h-8 text-xs" /></div>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" onClick={createCampaign} className="bg-amber-500 hover:bg-amber-600 text-black">Create Campaign</Button>
                      <Button size="sm" variant="outline" onClick={() => setShowNewCampaign(false)}>Cancel</Button>
                    </div>
                  </div>
                )}

                {campaigns.length === 0 ? (
                  <div className="text-center py-10">
                    <Users className="h-10 w-10 text-muted-foreground mx-auto opacity-30 mb-2" />
                    <p className="text-muted-foreground">No campaigns yet. Create your first campaign above.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {campaigns.map((c: any) => (
                      <div key={c.id} className="p-3 rounded-lg border border-border/50 bg-card/50 space-y-2">
                        <div className="flex items-center justify-between">
                          <p className="font-semibold text-sm">{c.name}</p>
                          <Badge variant="outline" className="text-xs capitalize">{c.status}</Badge>
                        </div>
                        {c.objective && <p className="text-xs text-muted-foreground">{c.objective}</p>}
                        <div className="flex items-center gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{c.totalPieces ?? 0} pieces</span>
                          {Array.isArray(c.platforms) && c.platforms.length > 0 && (
                            <span className="flex items-center gap-1"><Globe className="h-3 w-3" />{c.platforms.join(", ")}</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
