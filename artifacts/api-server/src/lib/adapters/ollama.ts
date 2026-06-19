import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";
import { buildAdapterJsonSchema, parseAdapterJson } from "./shared";
import { logger } from "../logger";

/**
 * OllamaAdapter — runs fully local open-source models via Ollama.
 *
 * Ollama is 100% free. No API key, no cloud calls, no cost per token.
 * Users install Ollama from https://ollama.com, pull a model, and point
 * OLLAMA_BASE_URL at it (defaults to http://localhost:11434).
 *
 * Recommended models (pull with `ollama pull <name>`):
 *   - llama3.2          (3B — fast, good general purpose)
 *   - llama3.1:8b       (8B — better quality, tool calling supported)
 *   - qwen2.5:7b        (7B — excellent coder, tool calling supported)
 *   - mistral:7b        (7B — solid all-rounder)
 *   - deepseek-r1:8b    (8B — strong reasoning)
 *
 * Tool calling: supported on llama3.1, qwen2.5, mistral, and others.
 * Set OLLAMA_MODEL to a tool-capable model to enable canUseTools.
 */
export class OllamaAdapter implements AgentAdapter {
  id: string;
  name: string;
  provider = "ollama";
  capabilities = ["planning", "reasoning", "code_review", "build", "implementation", "research"];
  role: string;
  isMock = false;
  canUseTools: boolean;
  model: string;

  private baseUrl: string;

  constructor(id: string, name: string, role: string, model?: string, baseUrl?: string, canUseTools = true) {
    this.id = id;
    this.name = name;
    this.role = role;
    this.model = model ?? process.env["OLLAMA_MODEL"] ?? "llama3.2";
    this.baseUrl = (baseUrl ?? process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434").replace(/\/$/, "");
    this.canUseTools = canUseTools;
  }

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    const systemPrompt = `You are ${this.name}, an AI agent with the role of ${this.role} in VIBA — Collaborative Multi-Agent Orchestration System.

Project Goal: ${input.projectGoal}

Shared Memory Summary: ${input.memorySummary || "No previous context."}

Your task: ${input.taskInstruction}
${buildAdapterJsonSchema(this.canUseTools, input.pendingQuestions)}`;

    const messages = input.previousMessages.map((m) => ({
      role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
      content: m.agentName ? `[${m.agentName}]: ${m.content}` : m.content,
    }));
    messages.push({ role: "user", content: input.taskInstruction });

    try {
      const { default: OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: "ollama",           // Ollama ignores the key but the SDK requires a non-empty value
        baseURL: `${this.baseUrl}/v1`,
        timeout: 60_000,           // local models can be slow on first token
      });

      const response = await client.chat.completions.create({
        model: this.model,
        messages: [{ role: "system", content: systemPrompt }, ...messages.slice(-15)],
        max_tokens: 2048,
        temperature: 0.7,
      });

      const text = response.choices[0]?.message?.content ?? "";
      // Ollama is free — no token cost
      return parseAdapterJson(text, 0);
    } catch (err) {
      logger.error({ err, baseUrl: this.baseUrl, model: this.model }, "Ollama API call failed");
      throw err;
    }
  }

  async evaluateTask(_goal: string, _peers: Array<{ name: string; role: string }>): Promise<{ accepted: boolean; reason?: string }> {
    // Local models have no external policy — always accept
    return { accepted: true };
  }
}
