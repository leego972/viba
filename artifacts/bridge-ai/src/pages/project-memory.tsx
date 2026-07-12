import { useState } from "react";
import { AppLayout } from "@/components/layout/AppLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pin, PinOff, Trash2, Plus, Loader2, AlertTriangle, CheckCircle, Brain, Pencil, X, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ProjectMemoryEntry {
  id: number;
  project_id: string;
  memory_type: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  user_confirmed: boolean;
  pinned: boolean;
  outdated: boolean;
  created_at: string;
}

interface Project {
  project_id: string;
  memory_count: number;
  last_updated: string;
}

const MEMORY_TYPES = ["general", "architecture", "decisions", "issues", "preferences", "stack", "deployment"];

const TYPE_COLORS: Record<string, string> = {
  general:      "bg-muted/50 text-muted-foreground border-border/40",
  architecture: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  decisions:    "bg-violet-500/15 text-violet-400 border-violet-500/30",
  issues:       "bg-rose-500/15 text-rose-400 border-rose-500/30",
  preferences:  "bg-amber-500/15 text-amber-400 border-amber-500/30",
  stack:        "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  deployment:   "bg-sky-500/15 text-sky-400 border-sky-500/30",
};

export default function ProjectMemoryPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [newProjectId, setNewProjectId] = useState("");
  const [newEntry, setNewEntry] = useState({ key: "", value: "", memoryType: "general" });
  const [showAdd, setShowAdd] = useState(false);

  const { data: projectsData } = useQuery<{ projects: Project[] }>({
    queryKey: ["/api/project-memory/projects"],
    queryFn: () => fetch("/api/project-memory/projects", { credentials: "include" }).then(r => r.json()),
  });

  const { data: memoriesData, isLoading } = useQuery<{ memories: ProjectMemoryEntry[] }>({
    queryKey: ["/api/project-memory", selectedProject],
    queryFn: () =>
      fetch(`/api/project-memory?projectId=${encodeURIComponent(selectedProject)}`, { credentials: "include" }).then(r => r.json()),
    enabled: !!selectedProject,
  });

  const addMemory = useMutation({
    mutationFn: () =>
      fetch("/api/project-memory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ projectId: selectedProject || newProjectId, ...newEntry, userConfirmed: true }),
      }).then(r => r.json()),
    onSuccess: () => {
      const pid = selectedProject || newProjectId;
      if (!selectedProject) setSelectedProject(pid);
      qc.invalidateQueries({ queryKey: ["/api/project-memory"] });
      setNewEntry({ key: "", value: "", memoryType: "general" });
      setShowAdd(false);
      toast({ title: "Memory saved" });
    },
    onError: () => toast({ title: "Failed to save memory", variant: "destructive" }),
  });

  const patchMemory = useMutation({
    mutationFn: ({ id, ...data }: Record<string, unknown>) =>
      fetch(`/api/project-memory/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/project-memory"] });
      toast({ title: "Memory updated" });
    },
    onError: () => toast({ title: "Failed to update memory", variant: "destructive" }),
  });

  const deleteMemory = useMutation({
    mutationFn: (id: number) =>
      fetch(`/api/project-memory/${id}`, { method: "DELETE", credentials: "include" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/project-memory"] });
      toast({ title: "Memory deleted" });
    },
  });

  const projects = projectsData?.projects ?? [];
  const memories = memoriesData?.memories ?? [];
  const pinned = memories.filter(m => m.pinned);
  const unpinned = memories.filter(m => !m.pinned);

  return (
    <AppLayout>
      <div className="container max-w-4xl py-8 space-y-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Project Memory</h1>
          <p className="text-muted-foreground mt-1">
            Structured context stored once and reused — instead of re-sending full conversation history on every task.
          </p>
        </div>

        {/* Project selector */}
        <Card className="border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> Select Project
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {projects.length > 0 && (
              <Select value={selectedProject} onValueChange={setSelectedProject}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Choose a project…" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map(p => (
                    <SelectItem key={p.project_id} value={p.project_id}>
                      {p.project_id}
                      <span className="text-muted-foreground ml-2">({p.memory_count} entries)</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <div className="flex gap-2">
              <Input
                placeholder={projects.length > 0 ? "Or enter a new project ID…" : "Enter a project ID to get started…"}
                value={newProjectId}
                onChange={e => setNewProjectId(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && newProjectId) { setSelectedProject(newProjectId); setNewProjectId(""); } }}
                className="h-9 text-sm"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => { if (newProjectId) { setSelectedProject(newProjectId); setNewProjectId(""); } }}
                disabled={!newProjectId.trim()}
              >
                Load
              </Button>
            </div>
          </CardContent>
        </Card>

        {selectedProject && (
          <>
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">{selectedProject}</h2>
                <p className="text-xs text-muted-foreground">{memories.length} memory {memories.length === 1 ? "entry" : "entries"}</p>
              </div>
              <Button size="sm" onClick={() => setShowAdd(s => !s)}>
                {showAdd ? <X className="h-4 w-4 mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
                {showAdd ? "Cancel" : "Add Memory"}
              </Button>
            </div>

            {showAdd && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader><CardTitle className="text-sm">New Memory Entry</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs mb-1.5 block">Type</Label>
                      <Select value={newEntry.memoryType} onValueChange={v => setNewEntry(e => ({ ...e, memoryType: v }))}>
                        <SelectTrigger className="h-9 text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {MEMORY_TYPES.map(t => (
                            <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs mb-1.5 block">Key / label</Label>
                      <Input
                        placeholder="e.g. tech_stack"
                        value={newEntry.key}
                        onChange={e => setNewEntry(n => ({ ...n, key: e.target.value }))}
                        className="h-9 text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs mb-1.5 block">Value</Label>
                    <Textarea
                      placeholder="e.g. React 19, TypeScript 5, PostgreSQL, Drizzle ORM, Express 5"
                      value={newEntry.value}
                      onChange={e => setNewEntry(n => ({ ...n, value: e.target.value }))}
                      rows={3}
                      className="text-sm resize-none"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => addMemory.mutate()}
                      disabled={!newEntry.key.trim() || !newEntry.value.trim() || addMemory.isPending}
                    >
                      {addMemory.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Save Entry
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {isLoading ? (
              <div className="text-center py-12 text-sm text-muted-foreground">Loading memory…</div>
            ) : memories.length === 0 ? (
              <Card className="border-border/50">
                <CardContent className="py-16 text-center">
                  <Brain className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground mb-3">
                    No memory entries yet.
                  </p>
                  <p className="text-xs text-muted-foreground/70 max-w-md mx-auto">
                    Add context that VIBA should reuse across tasks — for example your tech stack, deployment environment, or past decisions — instead of re-sending it each time.
                  </p>
                  <Button size="sm" className="mt-4" onClick={() => setShowAdd(true)}>
                    <Plus className="h-4 w-4 mr-2" /> Add First Entry
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {pinned.length > 0 && (
                  <div>
                    <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Pinned</p>
                    <div className="space-y-2">
                      {pinned.map(m => (
                        <MemoryCard
                          key={m.id}
                          memory={m}
                          onPatch={patchMemory.mutate}
                          onDelete={deleteMemory.mutate}
                          isSaving={patchMemory.isPending}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {unpinned.length > 0 && (
                  <div>
                    {pinned.length > 0 && (
                      <p className="text-xs text-muted-foreground font-medium mb-2 uppercase tracking-wide">Other entries</p>
                    )}
                    <div className="space-y-2">
                      {unpinned.map(m => (
                        <MemoryCard
                          key={m.id}
                          memory={m}
                          onPatch={patchMemory.mutate}
                          onDelete={deleteMemory.mutate}
                          isSaving={patchMemory.isPending}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </AppLayout>
  );
}

function MemoryCard({
  memory: m,
  onPatch,
  onDelete,
  isSaving,
}: {
  memory: ProjectMemoryEntry;
  onPatch: (data: Record<string, unknown>) => void;
  onDelete: (id: number) => void;
  isSaving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(m.value);
  const [editKey, setEditKey] = useState(m.key);

  function handleSaveEdit() {
    if (!editValue.trim() || !editKey.trim()) return;
    onPatch({ id: m.id, value: editValue.trim(), key: editKey.trim() });
    setEditing(false);
  }

  function handleCancelEdit() {
    setEditValue(m.value);
    setEditKey(m.key);
    setEditing(false);
  }

  return (
    <Card className={`border-border/40 transition-colors ${m.pinned ? "border-primary/20 bg-primary/5" : "bg-card/50"} ${m.outdated ? "opacity-60" : ""}`}>
      <CardContent className="py-3 px-4">
        {editing ? (
          <div className="space-y-2">
            <div className="grid sm:grid-cols-3 gap-2">
              <div>
                <Label className="text-[10px] mb-1 block text-muted-foreground">Key</Label>
                <Input
                  value={editKey}
                  onChange={e => setEditKey(e.target.value)}
                  className="h-8 text-xs"
                  autoFocus
                />
              </div>
              <div className="sm:col-span-2">
                <Label className="text-[10px] mb-1 block text-muted-foreground">Value</Label>
                <Textarea
                  value={editValue}
                  onChange={e => setEditValue(e.target.value)}
                  rows={2}
                  className="text-xs resize-none"
                />
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs px-3"
                onClick={handleSaveEdit}
                disabled={!editValue.trim() || !editKey.trim() || isSaving}
              >
                {isSaving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Check className="h-3 w-3 mr-1" />}
                Save
              </Button>
              <Button size="sm" variant="ghost" className="h-7 text-xs px-3" onClick={handleCancelEdit}>
                <X className="h-3 w-3 mr-1" /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <Badge className={`text-[10px] border px-1.5 py-0 capitalize ${TYPE_COLORS[m.memory_type] ?? TYPE_COLORS["general"]}`}>
                  {m.memory_type}
                </Badge>
                <span className="text-sm font-medium truncate">{m.key}</span>
                {m.user_confirmed && <CheckCircle className="h-3 w-3 text-emerald-400 shrink-0" />}
                {m.outdated && (
                  <span className="flex items-center gap-1 text-[10px] text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Outdated
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{m.value}</p>
              <p className="text-[10px] text-muted-foreground/50 mt-1.5">
                {m.source} · {new Date(m.created_at).toLocaleDateString()}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
                title="Edit"
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                onClick={() => onPatch({ id: m.id, pinned: !m.pinned })}
                title={m.pinned ? "Unpin" : "Pin"}
              >
                {m.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
              {!m.outdated && (
                <Button
                  variant="ghost" size="sm"
                  className="h-7 w-7 p-0 text-muted-foreground hover:text-amber-400"
                  onClick={() => onPatch({ id: m.id, outdated: true })}
                  title="Mark outdated"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button
                variant="ghost" size="sm"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                onClick={() => onDelete(m.id)}
                title="Delete"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
