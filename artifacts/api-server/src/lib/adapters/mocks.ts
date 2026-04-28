import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";

function randomCost(): number {
  return Math.round(Math.random() * 0.005 * 10000) / 10000;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

abstract class MockAdapter implements AgentAdapter {
  abstract id: string;
  abstract name: string;
  abstract provider: string;
  abstract capabilities: string[];
  abstract role: string;
  isMock = true;

  abstract generateResponse(input: AgentTaskInput): string;

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    await delay(500 + Math.random() * 500);
    const messageText = this.generateResponse(input);
    const statusOptions: AgentTaskResult["completionStatus"][] = ["in_progress", "in_progress", "needs_review", "complete"];
    const completionStatus = statusOptions[Math.floor(Math.random() * statusOptions.length)];
    return {
      messageText,
      suggestedNextTasks: [],
      completionStatus,
      confidence: 0.7 + Math.random() * 0.25,
      estimatedCost: randomCost(),
    };
  }
}

export class ClaudeMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "anthropic";
  capabilities = ["code_review", "writing", "logic_critique", "ux_review"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `As the ${this.role}, I've reviewed the current approach for "${input.projectGoal}". The logic is sound, but I'd suggest tightening the narrative flow. The key risk I see is scope creep — we should anchor each deliverable to the core goal before expanding. I recommend we validate the current output against the original brief before proceeding.`,
      `My critique of the current work: the structure is solid but the details need refinement. For "${input.projectGoal}", the reviewer's job is to catch what others miss. I've flagged three areas: (1) unclear success criteria, (2) missing edge case handling, and (3) the handoff between the builder and QA stages needs a clearer protocol.`,
      `Review complete. The output quality is good with some caveats. I recommend one revision cycle before marking this complete. The writing is clear, the logic holds, but the implementation details in the builder's section could use more precision.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

export class ManusMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "manus";
  capabilities = ["research", "execution", "data_gathering", "analysis"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `Research complete for "${input.projectGoal}". I've synthesized the key data points: market context shows strong demand in this space, competitive landscape has 3 major players, and the technical feasibility is high. Recommended approach: start with the highest-impact component and iterate. Data sources reviewed: industry reports, recent case studies, and technical documentation.`,
      `Execution update: I've mapped out the implementation path for "${input.projectGoal}". The research phase is done — here are the top 5 findings relevant to our goal. I'm now ready to hand off structured data to the Builder. All external sources have been cross-referenced and validated.`,
      `Analysis complete. For "${input.projectGoal}", the optimal execution path involves 4 phases. I've gathered supporting evidence for each decision point. The risk profile is manageable if we front-load the validation steps. Recommend: proceed with confidence.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

export class ReplitMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "replit";
  capabilities = ["build", "code", "deployment", "implementation"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `Builder ready. For "${input.projectGoal}", I've scaffolded the implementation structure. Key components: main module, data layer, API interface. The architecture follows clean separation of concerns. First build is complete — unit tests pass, edge cases handled. Ready for code review before deployment.`,
      `Implementation complete for this task in "${input.projectGoal}". Code is modular, typed, and documented. I've used a lean stack to keep costs low and performance high. The deployment configuration is ready — can push to production after approval. Estimated runtime: minimal.`,
      `Build phase done. I've implemented the core functionality for "${input.projectGoal}" with a focus on reliability and maintainability. Code has been structured for easy extension — the next Builder sprint can pick up from here without context loss.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

export class GeminiMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "google";
  capabilities = ["multimodal", "contextual_analysis", "summarization", "creative"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `Contextual analysis for "${input.projectGoal}": I've processed all available context — text, structure, and intent signals. The cross-modal synthesis reveals three key themes. Recommendation: align the next phase around theme 2 (highest signal strength). The visual and structural coherence of the deliverable is strong.`,
      `Multimodal review complete. For "${input.projectGoal}", I've analyzed the content from multiple dimensions: narrative flow, structural integrity, and audience fit. The output scores well on clarity but could benefit from a stronger visual hierarchy. Suggest one revision focused on presentation.`,
      `Summary and synthesis for "${input.projectGoal}": All agent outputs processed. The collective output is coherent and on-track. Key insight: the Researcher's data validates the Creative Director's approach. Recommend proceeding to the build phase with high confidence.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

export class PerplexityMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "perplexity";
  capabilities = ["research_summary", "fact_checking", "citation", "web_search"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `Research summary for "${input.projectGoal}": I've compiled authoritative sources on this topic. Key findings: (1) industry best practices align with our approach, (2) three recent case studies confirm feasibility, (3) no major regulatory blockers identified. All claims fact-checked. Confidence: high.`,
      `Fact-check complete for "${input.projectGoal}". All major assertions in the current output have been verified against primary sources. Two minor corrections flagged — details provided. The strategic direction is well-supported by evidence. Recommend proceeding.`,
      `Web research synthesis: For "${input.projectGoal}", the current landscape shows this is the right direction. Competitors are moving slower in this space. The research gives us a 6-month advantage window. Key external factors to monitor: 2 risks, 3 opportunities. Full citations available on request.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}

export class ChatGPTMockAdapter extends MockAdapter {
  id: string;
  name: string;
  provider = "openai";
  capabilities = ["planning", "strategy", "creative_direction", "final_qa"];
  role: string;

  constructor(id: string, name: string, role: string) {
    super();
    this.id = id;
    this.name = name;
    this.role = role;
  }

  generateResponse(input: AgentTaskInput): string {
    const responses = [
      `Strategic analysis for "${input.projectGoal}": I've evaluated the full scope and created a structured plan. Phase 1 focuses on research and validation (low risk, high learning). Phase 2 is execution (focused scope, clear deliverables). Phase 3 is review and refinement (quality gate before final output). All agents have clear handoffs.`,
      `Creative direction for "${input.projectGoal}": The core creative concept should emphasize clarity and impact. Key decisions: positioning, tone, and audience fit. I recommend a focused narrative that speaks to the primary use case. The aesthetic should reinforce the core message — confident, clean, purposeful.`,
      `Planning phase complete for "${input.projectGoal}". The task breakdown is clear and all agents have role clarity. Estimated total effort: moderate. Key risks identified and mitigated in the plan. Ready to assign tasks to the appropriate agents.`,
    ];
    return responses[Math.floor(Math.random() * responses.length)];
  }
}
