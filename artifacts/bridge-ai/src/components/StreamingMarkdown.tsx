import { useState, useEffect, useRef } from "react";
import { MarkdownContent } from "@/components/MarkdownContent";

interface Props {
  content: string;
  isNew: boolean;
}

/**
 * Reveals markdown content progressively when `isNew` is true —
 * simulating real-time streaming even when the full message arrives at once.
 * Existing messages (isNew=false) render instantly with no animation.
 */
export function StreamingMarkdown({ content, isNew }: Props) {
  const [revealed, setRevealed] = useState(isNew ? "" : content);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!isNew) {
      setRevealed(content);
      return;
    }

    // Batch 5 tokens at ~35 ms — feels like ~140 tokens/sec (GPT-4 live pace)
    const tokens = content.split(/(\s+)/);
    let idx = 0;

    const tick = () => {
      idx = Math.min(idx + 5, tokens.length);
      setRevealed(tokens.slice(0, idx).join(""));
      if (idx >= tokens.length && timerRef.current) {
        clearInterval(timerRef.current);
      }
    };

    timerRef.current = setInterval(tick, 35);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [content, isNew]);

  return <MarkdownContent content={revealed} />;
}
