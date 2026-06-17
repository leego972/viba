import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import {
  GitBranch,
  ExternalLink,
  Terminal,
  TestTube2,
  GitCommit,
  FileCode2,
  Hammer,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  XCircle,
  Clock,
} from "lucide-react";

export type FileDiffOutput = {
  type: "file_diff";
  filename: string;
  diff: string;
  additions?: number | null;
  deletions?: number | null;
};

export type TestResultOutput = {
  type: "test_result";
  passed: number;
  failed: number;
  skipped?: number | null;
  duration?: number | null;
  log?: string | null;
};

export type DeploymentUrlOutput = {
  type: "deployment_url";
  url: string;
  environment?: string | null;
  label?: string | null;
};

export type CommandOutput = {
  type: "command_output";
  command: string;
  output: string;
  exitCode?: number | null;
};

export type BuildLogOutput = {
  type: "build_log";
  log: string;
  success: boolean;
  duration?: number | null;
};

export type GitOperationOutput = {
  type: "git_operation";
  operation: string;
  branch: string;
  commitSha?: string | null;
  commitMessage?: string | null;
};

export type ToolOutput =
  | FileDiffOutput
  | TestResultOutput
  | DeploymentUrlOutput
  | CommandOutput
  | BuildLogOutput
  | GitOperationOutput;

function FileDiffCard({ output }: { output: FileDiffOutput }) {
  const [open, setOpen] = useState(false);
  const lines = output.diff.split("\n");

  return (
    <div className="rounded border border-violet-500/25 bg-violet-500/5 text-xs overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-500/10 transition-colors"
      >
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-violet-400" />
        <span className="font-mono font-semibold text-violet-200 truncate flex-1">{output.filename}</span>
        <div className="flex items-center gap-2 shrink-0">
          {output.additions != null && (
            <span className="text-emerald-400 font-mono">+{output.additions}</span>
          )}
          {output.deletions != null && (
            <span className="text-red-400 font-mono">-{output.deletions}</span>
          )}
          {open ? (
            <ChevronDown className="h-3 w-3 text-violet-400" />
          ) : (
            <ChevronRight className="h-3 w-3 text-violet-400" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-violet-500/20 overflow-x-auto max-h-64 overflow-y-auto">
          <pre className="p-3 text-[11px] leading-relaxed">
            {lines.map((line, i) => {
              const isAdd = line.startsWith("+") && !line.startsWith("+++");
              const isDel = line.startsWith("-") && !line.startsWith("---");
              const isHunk = line.startsWith("@@");
              return (
                <div
                  key={i}
                  className={
                    isAdd
                      ? "text-emerald-300 bg-emerald-500/10"
                      : isDel
                        ? "text-red-300 bg-red-500/10"
                        : isHunk
                          ? "text-blue-300 opacity-70"
                          : "text-muted-foreground"
                  }
                >
                  {line || " "}
                </div>
              );
            })}
          </pre>
        </div>
      )}
    </div>
  );
}

function TestResultCard({ output }: { output: TestResultOutput }) {
  const [logOpen, setLogOpen] = useState(false);
  const total = output.passed + output.failed + (output.skipped ?? 0);
  const allPassed = output.failed === 0;

  return (
    <div
      className={`rounded border text-xs overflow-hidden ${
        allPassed
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-red-500/25 bg-red-500/5"
      }`}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <TestTube2
          className={`h-3.5 w-3.5 shrink-0 ${allPassed ? "text-emerald-400" : "text-red-400"}`}
        />
        <span className={`font-semibold ${allPassed ? "text-emerald-200" : "text-red-200"}`}>
          Test Results
        </span>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          <span className="flex items-center gap-1 text-emerald-400">
            <CheckCircle2 className="h-3 w-3" /> {output.passed} passed
          </span>
          {output.failed > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <XCircle className="h-3 w-3" /> {output.failed} failed
            </span>
          )}
          {output.skipped != null && output.skipped > 0 && (
            <span className="text-muted-foreground">{output.skipped} skipped</span>
          )}
          {output.duration != null && (
            <span className="flex items-center gap-1 text-muted-foreground font-mono">
              <Clock className="h-3 w-3" /> {output.duration.toFixed(1)}s
            </span>
          )}
          <Badge
            variant="outline"
            className={`text-[10px] h-4 px-1.5 ${
              allPassed
                ? "text-emerald-400 border-emerald-500/40"
                : "text-red-400 border-red-500/40"
            }`}
          >
            {output.passed}/{total}
          </Badge>
        </div>
      </div>
      {output.log && (
        <div className={`border-t ${allPassed ? "border-emerald-500/20" : "border-red-500/20"}`}>
          <button
            type="button"
            onClick={() => setLogOpen((v) => !v)}
            className={`w-full flex items-center gap-1.5 px-3 py-1.5 text-left transition-colors text-[11px] font-semibold ${
              allPassed
                ? "text-emerald-300/70 hover:bg-emerald-500/10"
                : "text-red-300/70 hover:bg-red-500/10"
            }`}
          >
            {logOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            View log
          </button>
          {logOpen && (
            <pre className="px-3 pb-3 text-[11px] leading-relaxed text-muted-foreground overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
              {output.log}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function DeploymentUrlCard({ output }: { output: DeploymentUrlOutput }) {
  const envStyles: Record<string, string> = {
    production: "text-red-400 border-red-500/40",
    staging: "text-amber-400 border-amber-500/40",
    development: "text-blue-400 border-blue-500/40",
  };
  const envStyle = output.environment
    ? (envStyles[output.environment.toLowerCase()] ?? "text-muted-foreground border-border/60")
    : "text-muted-foreground border-border/60";

  return (
    <div className="rounded border border-sky-500/25 bg-sky-500/5 text-xs">
      <div className="flex items-center gap-2 px-3 py-2">
        <ExternalLink className="h-3.5 w-3.5 shrink-0 text-sky-400" />
        <span className="font-semibold text-sky-200">
          {output.label ?? "Deployed"}
        </span>
        {output.environment && (
          <Badge variant="outline" className={`text-[10px] h-4 px-1.5 capitalize ${envStyle}`}>
            {output.environment}
          </Badge>
        )}
        <a
          href={output.url}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto font-mono text-sky-300 hover:text-sky-100 underline underline-offset-2 truncate max-w-[200px] transition-colors"
          title={output.url}
        >
          {output.url}
        </a>
      </div>
    </div>
  );
}

function CommandOutputCard({ output }: { output: CommandOutput }) {
  const [open, setOpen] = useState(false);
  const success = output.exitCode == null || output.exitCode === 0;

  return (
    <div
      className={`rounded border text-xs overflow-hidden ${
        success ? "border-zinc-500/25 bg-zinc-500/5" : "border-red-500/25 bg-red-500/5"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Terminal className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
        <code className="font-mono text-zinc-200 truncate flex-1">{output.command}</code>
        <div className="flex items-center gap-2 shrink-0">
          {output.exitCode != null && (
            <Badge
              variant="outline"
              className={`text-[10px] h-4 px-1.5 font-mono ${
                success ? "text-emerald-400 border-emerald-500/40" : "text-red-400 border-red-500/40"
              }`}
            >
              exit {output.exitCode}
            </Badge>
          )}
          {open ? (
            <ChevronDown className="h-3 w-3 text-zinc-400" />
          ) : (
            <ChevronRight className="h-3 w-3 text-zinc-400" />
          )}
        </div>
      </button>
      {open && (
        <div className="border-t border-zinc-500/20">
          <pre className="px-3 py-2 text-[11px] leading-relaxed text-zinc-300 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap">
            {output.output || "(no output)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function BuildLogCard({ output }: { output: BuildLogOutput }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className={`rounded border text-xs overflow-hidden ${
        output.success
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-red-500/25 bg-red-500/5"
      }`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 transition-colors"
      >
        <Hammer
          className={`h-3.5 w-3.5 shrink-0 ${output.success ? "text-emerald-400" : "text-red-400"}`}
        />
        <span className={`font-semibold ${output.success ? "text-emerald-200" : "text-red-200"}`}>
          Build {output.success ? "succeeded" : "failed"}
        </span>
        <div className="flex items-center gap-2 ml-auto shrink-0">
          {output.duration != null && (
            <span className="flex items-center gap-1 text-muted-foreground font-mono">
              <Clock className="h-3 w-3" /> {output.duration.toFixed(1)}s
            </span>
          )}
          {open ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
      </button>
      {open && (
        <div
          className={`border-t ${output.success ? "border-emerald-500/20" : "border-red-500/20"}`}
        >
          <pre className="px-3 py-2 text-[11px] leading-relaxed text-muted-foreground overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
            {output.log || "(empty log)"}
          </pre>
        </div>
      )}
    </div>
  );
}

function GitOperationCard({ output }: { output: GitOperationOutput }) {
  return (
    <div className="rounded border border-indigo-500/25 bg-indigo-500/5 text-xs">
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        <GitCommit className="h-3.5 w-3.5 shrink-0 text-indigo-400" />
        <span className="font-semibold text-indigo-200 capitalize">{output.operation}</span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 gap-1 text-indigo-300 border-indigo-500/40 font-mono">
          <GitBranch className="h-2.5 w-2.5" />
          {output.branch}
        </Badge>
        {output.commitSha && (
          <code className="text-[10px] font-mono text-indigo-300/70 bg-black/20 rounded px-1">
            {output.commitSha.slice(0, 7)}
          </code>
        )}
        {output.commitMessage && (
          <span className="text-indigo-200/70 italic truncate max-w-[200px]" title={output.commitMessage}>
            {output.commitMessage}
          </span>
        )}
      </div>
    </div>
  );
}

interface ToolOutputCardsProps {
  outputs: ToolOutput[];
}

export function ToolOutputCards({ outputs }: ToolOutputCardsProps) {
  if (!outputs || outputs.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5 mt-2 pt-2 border-t border-white/10">
      {outputs.map((output, i) => {
        switch (output.type) {
          case "file_diff":
            return <FileDiffCard key={i} output={output} />;
          case "test_result":
            return <TestResultCard key={i} output={output} />;
          case "deployment_url":
            return <DeploymentUrlCard key={i} output={output} />;
          case "command_output":
            return <CommandOutputCard key={i} output={output} />;
          case "build_log":
            return <BuildLogCard key={i} output={output} />;
          case "git_operation":
            return <GitOperationCard key={i} output={output} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
