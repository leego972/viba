import { useRef, useState } from "react";
import { Paperclip, RefreshCw, Send, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type AttachmentComposerProps = {
  sessionId: number;
  disabled?: boolean;
  running?: boolean;
  onStop?: () => void;
  onComplete?: () => void | Promise<void>;
  placeholder?: string;
};

type SelectedFile = {
  file: File;
  id: string;
};

function fileKind(file: File): "Image" | "Video" | "File" {
  if (file.type.startsWith("image/")) return "Image";
  if (file.type.startsWith("video/")) return "Video";
  return "File";
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function newId(file: File): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
  return `${file.name}-${file.size}-${random}`;
}

async function uploadAttachment(sessionId: number, file: File, caption: string) {
  const response = await fetch(`/api/sessions/${sessionId}/attachments`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
      "X-File-Name": encodeURIComponent(file.name),
      "X-VIBA-Caption": caption,
    },
    body: file,
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Upload failed");
    throw new Error(errorText || "Upload failed");
  }
  return response.json();
}

async function sendInstruction(sessionId: number, content: string) {
  const response = await fetch(`/api/sessions/${sessionId}/instruct`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!response.ok) {
    const errorText = await response.text().catch(() => "Instruction failed");
    throw new Error(errorText || "Instruction failed");
  }
  return response.json();
}

export function AttachmentComposer({ sessionId, disabled, running, onStop, onComplete, placeholder }: AttachmentComposerProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<SelectedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const canSend = !disabled && !busy && (text.trim().length > 0 || files.length > 0);

  const removeFile = (id: string) => {
    setFiles((current) => current.filter((item) => item.id !== id));
  };

  const submit = async () => {
    if (!canSend) return;
    const caption = text.trim();
    setBusy(true);
    try {
      if (caption) await sendInstruction(sessionId, caption);
      for (const selected of files) await uploadAttachment(sessionId, selected.file, caption);
      setText("");
      setFiles([]);
      await onComplete?.();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-[1.35rem] border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.10)] ring-1 ring-white">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 border-b border-slate-100 px-3 py-2">
          {files.map((item) => (
            <div key={item.id} className="flex max-w-full items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-700">
              <span className="font-semibold text-slate-900">{fileKind(item.file)}</span>
              <span className="max-w-[180px] truncate text-slate-500">{item.file.name}</span>
              <span className="text-slate-400">{fileSize(item.file.size)}</span>
              <button type="button" onClick={() => removeFile(item.id)} className="rounded-full p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700" aria-label="Remove file">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2 p-2 sm:p-3">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,.pdf,.txt,.md,.doc,.docx,.zip,.json,.csv,.xlsx,.ppt,.pptx"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).map((file) => ({ file, id: newId(file) }));
            setFiles((current) => [...current, ...selected]);
            event.currentTarget.value = "";
          }}
        />

        <Button type="button" variant="outline" size="icon" className="h-11 w-11 shrink-0 rounded-full border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 hover:text-slate-900" disabled={disabled || busy} onClick={() => fileRef.current?.click()} aria-label="Upload file">
          <Paperclip className="h-4 w-4" />
        </Button>

        <Textarea
          value={text}
          disabled={disabled || busy}
          placeholder={placeholder ?? "Ask VIBA what to build, fix, research, test, or plan..."}
          className="max-h-40 min-h-[52px] resize-none border-0 bg-transparent px-2 py-3 text-[15px] leading-6 text-slate-900 shadow-none placeholder:text-slate-400 focus-visible:ring-0"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />

        {running && onStop ? (
          <Button type="button" className="h-11 w-11 shrink-0 rounded-full bg-slate-900 text-white hover:bg-slate-700" onClick={onStop} aria-label="Stop session">
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="button" className="h-11 w-11 shrink-0 rounded-full bg-slate-900 text-white hover:bg-slate-700 disabled:bg-slate-200 disabled:text-slate-400" disabled={!canSend} onClick={() => void submit()} aria-label="Send instruction">
            {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        )}
      </div>
      <div className="flex items-center justify-between border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400">
        <span>Enter to send · Shift+Enter for new line</span>
        <span>{running ? "Agents working" : disabled ? "Session inactive" : "Ready"}</span>
      </div>
    </div>
  );
}
