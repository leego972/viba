import type { AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";

/**
 * Builds the JSON schema section of the system prompt, adapting to whether the
 * agent can use tools. Text-only agents (canUseTools=false) receive extra fields
 * so they can signal a tool handoff when they hit a blocker. All agents receive
 * the inter-agent comms fields (outboundQuestions / answersToQuestions).
 */
export function buildAdapterJsonSchema(
  canUseTools: boolean,
  pendingQuestions?: AgentTaskInput["pendingQuestions"],
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

  const toolBlockSchema = !canUseTools
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

  return `\n${questionSection}Respond in character as your role. Be specific, actionable, and concise. At the end of your response, include a JSON block (surrounded by \`\`\`json ... \`\`\`) with this structure:
${baseSchema}${toolBlockSchema}

Only include "outboundQuestions" if you genuinely need input from another agent for THIS task. Keep questions concise and task-scoped. Omit if not needed.
Only include "answersToQuestions" if there are pending questions listed above. Map each messageId to your answer.`;
}

/**
 * Parses the JSON block from an adapter response text.
 * Extracts all fields including optional handoff, comms, and tool output fields.
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
