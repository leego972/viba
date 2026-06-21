import { useRef, useState } from "react";
import { Paperclip, RefreshCw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type AttachmentComposerProps = {
  sessionId: number;
  disabled?: boolean;
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

export function AttachmentComposer({ sessionId, disabled, onComplete, placeholder }: AttachmentComposerProps) {
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
    <div className="flex flex-col gap-2 rounded-xl border bg-background/80 p-2 shadow-sm">
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1 pt-1">
          {files.map((item) => (
            <div key={item.id} className="flex items-center gap-2 rounded-lg border bg-muted/40 px-2 py-1 text-xs">
              <span className="font-medium">{fileKind(item.file)}</span>
              <span className="max-w-[180px] truncate text-muted-foreground">{item.file.name}</span>
              <span className="text-muted-foreground/70">{fileSize(item.file.size)}</span>
              <button type="button" onClick={() => removeFile(item.id)} className="text-muted-foreground hover:text-foreground" aria-label="Remove file">
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-2">
        <input
          ref={fileRef}
          type="file"
          multiple
          className="hidden"
          accept="image/*,video/*,.pdf,.txt,.md,.doc,.docx,.zip,.json,.csv,.xlsx,.ppt,.pptx"
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []).map((file) => ({ file, id: `${file.name}-${file.size}-${crypto.randomUUID?.() ?? Math.random()}` }));
            setFiles((current) => [...current, ...selected]);
            event.currentTarget.value = "";
          }}
        />

        <Button type="button" variant="outline" size="icon" className="shrink-0" disabled={disabled || busy} onClick={() => fileRef.current?.click()} aria-label="Attach file">
          <Paperclip className="h-4 w-4" />
        </Button>

        <Textarea
          value={text}
          disabled={disabled || busy}
          placeholder={placeholder ?? "Send an instruction, upload files, or give feedback to the agents..."}
          className="min-h-[56px] resize-none"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit();
            }
          }}
        />

        <Button type="button" className="h-auto w-12 shrink-0" disabled={!canSend} onClick={() => void submit()} aria-label="Send instruction">
          {busy ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </div>
    </div>
  );
}
