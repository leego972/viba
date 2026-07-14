import type { AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";

/**
 * Builds the JSON schema section of the system prompt.
 *
 * Three modes:
 *  - canUseTools=false              → tool-block schema (blockedReason / partialWork / toolRequirements)
 *  - canUseTools=true, brokerMode=false → base schema only (native executors: Replit / Manus / Groq own their tools)
 *  - canUseTools=true, brokerMode=true  → VIBA broker schema (text agents: OpenAI / Anthropic / Gemini / Perplexity)
 *
 * brokerMode should be true only for text-only LLM adapters that the user has
 * explicitly enabled tool access for. Native executors handle their own tool loops
 * and must NOT set brokerMode=true (they would get a broker prompt they can't act on).
 */
export function buildAdapterJsonSchema(
  canUseTools: boolean,
  pendingQuestions?: AgentTaskInput["pendingQuestions"],
  brokerMode = false,
): string {
  const questionSection =
    pendingQuestions && pendingQuestions.length > 0
      ? `\nPending questions from other agents that you MUST answer before your task:\n${pendingQuestions
          .map((q) => `  - [messageId: ${q.messageId}] ${q.fromAgent} asks: ${q.question}`)
          .join("\n")}\n`
      : "";

  const baseSchema = `{
  "suggestedNextTasks": ["string"],
  "completionStatus": "in_progress" | "complete" | "needs_review" | "approval_required",
  "confidence": 0.0-1.0,
  "outboundQuestions": [{ "toAgentName": "string", "question": "string" }],
  "answersToQuestions": [{ "messageId": number, "answer": "string" }]
}`;

  // ── Tool-block schema (text-only, no tools) ─────────────────────────────────
  const toolBlockSchema = (!canUseTools)
    ? `

If you require running code, executing shell commands, cloning a repo, calling an API, or any other tool-based action to complete your task, you CANNOT do it yourself. In that case:
- Set "completionStatus" to "needs_review"
- Set "blockedReason" to a clear one-sentence description of what tool capability you need
- Set "partialWork" to a full description of what you have completed so far (this will be handed to a tool-capable agent)
- Set "toolRequirements" to a list of specific tool names needed (e.g. ["git_clone", "run_tests", "deploy"])
- Do NOT fabricate tool output or pretend to run commands

Extended JSON when blocked:
{
  ...base fields...,
  "blockedReason": "string",
  "partialWork": "string",
  "toolRequirements": ["string"]
}`
    : "";

  // ── Broker tool schema (text agents with canUseTools=true in broker mode) ───
  const brokerSchema = (canUseTools && brokerMode)
    ? `

You have access to VIBA's tool broker. You may invoke ONE tool per response turn by adding a "toolCall" field to your JSON. VIBA will execute the tool, inject the result, and call you again so you can continue the task.

Available VIBA broker tools:
  • github.repo.read    / read   — Read repository files and directory structure
  • github.pr.create   / create — Open a pull request (title, body, head, base required in payload)
  • railway.deploy.status / status — Check Railway deployment status for a service
  • railway.env.read   / read   — Read Railway environment variable keys (values redacted)
  • stripe.products.read / read  — Read Stripe products and prices
  • stripe.webhook.verify / verify — Verify a Stripe webhook signature
  • credits.ledger.read / read  — Read credit balance and transaction history
  • dns.records.read   / read   — Read DNS records for a domain
  • browser.open       / open   — Fetch a URL and return page content or screenshot
  • smtp.test          / send   — Send a test email (to, subject, body required)
  • build.safe_build   / run    — Run typecheck + tests + build gate

Extended JSON when invoking a tool (omit toolCall if not needed this turn):
{
  ...base fields...,
  "toolCall": { "toolId": "github.repo.read", "action": "read", "payload": { "owner": "...", "repo": "...", "path": "..." } }
}

Note: Each tool call costs credits. Prefer read-only tools first. Do NOT fabricate tool results.`
    : "";

  return `\n${questionSection}Respond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:
${baseSchema}${toolBlockSchema}${brokerSchema}

Only include "outboundQuestions" if you genuinely need input from another agent for THIS task. Keep questions concise and task-scoped. Omit if not needed.
Only include "answersToQuestions" if there are pending questions listed above. Map each messageId to your answer.`;
}

/**
 * Parses the JSON block from an adapter response text.
 * Extracts all fields including optional handoff, comms, tool output, and broker toolCall fields.
 * Safe — never throws; falls back to defaults on parse failure.
 */
export function parseAdapterJson(text: string, estimatedCost: number): AgentTaskResult {
  let suggestedNextTasks: string[] = [];
  let completionStatus: AgentTaskResult["completionStatus"] = "in_progress";
  let confidence = 0.7;
  let blockedReason: string | undefined;
  let partialWork: string | undefined;
  let toolRequirements: string[] | undefined;
  let outboundQuestions: AgentTaskResult["outboundQuestions"];
  let answersToQuestions: AgentTaskResult["answersToQuestions"];
  let toolOutputs: ToolOutput[] | undefined;
  let toolCall: AgentTaskResult["toolCall"];
  let messageText = text;

  const jsonMatch = text.match(/```json\n([\s\S]*?)\n```/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]!);
      suggestedNextTasks = Array.isArray(parsed.suggestedNextTasks) ? parsed.suggestedNextTasks : [];
      completionStatus = parsed.completionStatus ?? "in_progress";
      confidence = parsed.confidence ?? 0.7;

      if (typeof parsed.blockedReason === "string" && parsed.blockedReason.length > 0) {
        blockedReason = parsed.blockedReason;
      }
      if (typeof parsed.partialWork === "string" && parsed.partialWork.length > 0) {
        partialWork = parsed.partialWork;
      }
      if (Array.isArray(parsed.toolRequirements) && parsed.toolRequirements.length > 0) {
        toolRequirements = parsed.toolRequirements.filter((r: unknown) => typeof r === "string");
      }
      if (Array.isArray(parsed.outboundQuestions) && parsed.outboundQuestions.length > 0) {
        outboundQuestions = parsed.outboundQuestions.filter(
          (q: unknown): q is { toAgentName: string; question: string } =>
            typeof q === "object" && q !== null &&
            typeof (q as Record<string, unknown>).toAgentName === "string" &&
            typeof (q as Record<string, unknown>).question === "string",
        );
      }
      if (Array.isArray(parsed.answersToQuestions) && parsed.answersToQuestions.length > 0) {
        answersToQuestions = parsed.answersToQuestions.filter(
          (a: unknown): a is { messageId: number; answer: string } =>
            typeof a === "object" && a !== null &&
            typeof (a as Record<string, unknown>).messageId === "number" &&
            typeof (a as Record<string, unknown>).answer === "string",
        );
      }

      // Parse VIBA broker tool call (only emitted by text agents in broker mode)
      if (
        typeof parsed.toolCall === "object" &&
        parsed.toolCall !== null &&
        typeof parsed.toolCall.toolId === "string" &&
        typeof parsed.toolCall.action === "string"
      ) {
        toolCall = {
          toolId: parsed.toolCall.toolId,
          action: parsed.toolCall.action,
          payload: typeof parsed.toolCall.payload === "object" && parsed.toolCall.payload !== null
            ? (parsed.toolCall.payload as Record<string, unknown>)
            : undefined,
        };
      }

      messageText = text.replace(/```json\n[\s\S]*?\n```/, "").trim();
    } catch {
      // ignore parse errors — return full text as messageText
    }
  }

  return {
    messageText,
    suggestedNextTasks,
    completionStatus,
    confidence,
    estimatedCost,
    blockedReason,
    partialWork,
    toolRequirements,
    outboundQuestions,
    answersToQuestions,
    toolOutputs,
    toolCall,
  };
}

/**
 * Validates and coerces a raw value into a ToolOutput array.
 * Used by adapters to normalize tool outputs from external API responses.
 */
export function normalizeToolOutputs(raw: unknown): ToolOutput[] {
  if (!Array.isArray(raw)) return [];
  const validTypes = new Set(["file_diff", "test_result", "deployment_url", "command_output", "git_operation", "build_log"]);
  return raw.filter((item): item is ToolOutput => {
    if (typeof item !== "object" || item === null) return false;
    const o = item as Record<string, unknown>;
    return (
      typeof o.type === "string" &&
      validTypes.has(o.type) &&
      typeof o.title === "string" &&
      typeof o.content === "string"
    );
  });
}
