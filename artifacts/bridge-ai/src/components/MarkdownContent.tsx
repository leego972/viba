import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  content: string;
  className?: string;
}

export function MarkdownContent({ content, className = "" }: MarkdownContentProps) {
  return (
    <div
      className={[
        "prose prose-sm prose-invert max-w-none leading-relaxed",
        "prose-p:my-1 prose-p:leading-relaxed",
        "prose-headings:font-semibold prose-headings:my-2 prose-h1:text-base prose-h2:text-sm prose-h3:text-sm",
        "prose-ul:my-1 prose-ol:my-1 prose-li:my-0",
        "prose-pre:bg-black/30 prose-pre:border prose-pre:border-white/10 prose-pre:rounded-lg prose-pre:text-xs",
        "prose-code:text-[0.8em] prose-code:bg-black/25 prose-code:rounded prose-code:px-1 prose-code:py-0.5 prose-code:before:content-none prose-code:after:content-none",
        "prose-blockquote:border-l-white/30 prose-blockquote:text-current/70 prose-blockquote:not-italic",
        "prose-a:text-current prose-a:underline prose-a:underline-offset-2 hover:prose-a:opacity-80",
        "prose-strong:font-semibold prose-strong:text-current",
        "prose-table:text-xs prose-th:font-semibold prose-td:py-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}
