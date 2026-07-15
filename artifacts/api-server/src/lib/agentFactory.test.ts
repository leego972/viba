import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  settingsTable: {},
}));

import { buildMockAdapter } from "./agentFactory";
import type { Agent } from "@workspace/db";

function makeAgent(provider: string, canUseTools: boolean): Agent {
  return {
    id: 1,
    sessionId: 1,
    name: "Test Agent",
    provider,
    role: "Builder",
    canUseTools,
    isMock: true,
    capabilities: [],
    lastUsedModel: null,
    satOutReason: null,
    createdAt: new Date(),
  } as unknown as Agent;
}

describe("buildMockAdapter — canUseTools propagation", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("Mistral mock adapter is never tool-capable (text-only)", () => {
    const adapter = buildMockAdapter(makeAgent("mistral", false));
    expect(adapter.canUseTools).toBe(false);
  });

  it("DeepSeek mock adapter is never tool-capable (text-only)", () => {
    const adapter = buildMockAdapter(makeAgent("deepseek", false));
    expect(adapter.canUseTools).toBe(false);
  });

  it("ChatGPT mock adapter is never tool-capable (text-only)", () => {
    const adapter = buildMockAdapter(makeAgent("openai", false));
    expect(adapter.canUseTools).toBe(false);
  });

  it("Claude mock adapter is never tool-capable (text-only)", () => {
    const adapter = buildMockAdapter(makeAgent("anthropic", false));
    expect(adapter.canUseTools).toBe(false);
  });
});
