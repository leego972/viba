/**
 * pdf_extract — extract plain text from a PDF URL.
 * Downloads the PDF and extracts readable text content.
 */

export interface PdfTool {
  definition: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } };
  execute(args: Record<string, unknown>): Promise<string>;
}

function str(v: unknown, fb = ""): string { return typeof v === "string" ? v : fb; }
function num(v: unknown, fb: number): number { return typeof v === "number" ? v : fb; }

export function getPdfTools(): PdfTool[] {
  return [
    {
      definition: {
        type: "function",
        function: {
          name: "pdf_extract",
          description: "Download a PDF from a URL and extract its text content. Use for reading research papers, contracts, reports, documentation PDFs, or any PDF-based content. Returns plain text up to 8000 chars.",
          parameters: {
            type: "object",
            properties: {
              url: { type: "string", description: "Public URL of the PDF file (must start with https://)" },
              max_chars: { type: "number", description: "Maximum characters to return (default 6000, max 8000)" },
              page_range: { type: "string", description: "Pages to extract, e.g. '1-3' or '1,2,5' (default: all pages)" },
            },
            required: ["url"],
          },
        },
      },
      async execute(args) {
        const url = str(args["url"]);
        if (!url || !url.startsWith("http")) return "Error: valid PDF url is required";

        const maxChars = Math.min(num(args["max_chars"], 6000), 8000);

        try {
          const res = await fetch(url, { headers: { "User-Agent": "VIBA-Agent/1.0" } });
          if (!res.ok) return `Error: HTTP ${res.status} fetching ${url}`;

          const contentType = res.headers.get("content-type") ?? "";
          if (!contentType.includes("pdf") && !url.toLowerCase().endsWith(".pdf")) {
            return `Warning: URL may not be a PDF (Content-Type: ${contentType}). Attempting extraction anyway.`;
          }

          const buffer = Buffer.from(await res.arrayBuffer());

          // Extract text from PDF binary using a simple regex-based approach
          // that reads uncompressed text streams from the PDF structure
          const text = extractTextFromPdf(buffer);
          if (!text || text.length < 20) {
            return `PDF downloaded (${buffer.length} bytes) but no readable text could be extracted. The PDF may be image-based or encrypted. Try browser_navigate + browser_screenshot + vision_analyze_image for image PDFs.`;
          }

          const truncated = text.length > maxChars
            ? text.slice(0, maxChars) + `\n\n...[${text.length - maxChars} additional chars truncated]`
            : text;

          return `PDF text extracted from ${url} (${Math.ceil(buffer.length / 1024)}KB):\n\n${truncated}`;
        } catch (err) {
          return `PDF extraction failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    },
  ];
}

function extractTextFromPdf(buffer: Buffer): string {
  const raw = buffer.toString("latin1");
  const textParts: string[] = [];

  // Extract text from BT...ET blocks (PDF text objects)
  const btEtRegex = /BT([\s\S]*?)ET/g;
  let match;
  while ((match = btEtRegex.exec(raw)) !== null) {
    const block = match[1] ?? "";
    // Extract strings from Tj, TJ, ' operators
    const strRegex = /\(([^)]*)\)\s*(?:Tj|'|")/g;
    let strMatch;
    while ((strMatch = strRegex.exec(block)) !== null) {
      const s = (strMatch[1] ?? "").replace(/\\n/g, "\n").replace(/\\r/g, "").replace(/\\t/g, " ");
      if (s.trim()) textParts.push(s);
    }
    // TJ arrays
    const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g;
    let tjMatch;
    while ((tjMatch = tjArrayRegex.exec(block)) !== null) {
      const arr = tjMatch[1] ?? "";
      const innerRegex = /\(([^)]*)\)/g;
      let inner;
      while ((inner = innerRegex.exec(arr)) !== null) {
        const s = (inner[1] ?? "").replace(/\\n/g, "\n");
        if (s.trim()) textParts.push(s);
      }
    }
  }

  return textParts.join(" ").replace(/\s+/g, " ").replace(/ \. /g, ". ").trim();
}
