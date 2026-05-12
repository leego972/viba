import type { AgentAdapter, AgentTaskInput, AgentTaskResult } from "./interface";

function randomCost(): number {
  return Math.round((0.001 + Math.random() * 0.006) * 10000) / 10000;
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)] as T;
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
    await delay(400 + Math.random() * 600);
    const messageText = this.generateResponse(input);
    // Tasks that are planning/research always go to review; build/code go to complete
    const buildTypes = new Set(["build", "code_review", "final_qa"]);
    const completionStatus: AgentTaskResult["completionStatus"] = buildTypes.has(input.taskType ?? "")
      ? pick(["complete", "needs_review"])
      : "needs_review";
    return {
      messageText,
      suggestedNextTasks: [],
      completionStatus,
      confidence: 0.72 + Math.random() * 0.24,
      estimatedCost: randomCost(),
    };
  }
}

// ── ChatGPT / OpenAI ──────────────────────────────────────────────────────────
export class ChatGPTMockAdapter extends MockAdapter {
  id: string; name: string; provider = "openai"; role: string;
  capabilities = ["planning", "reasoning", "creative_direction", "code_review", "final_qa"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "planning";
    const responses: Record<string, string[]> = {
      planning: [
        `Strategic plan for "${goal}": I've broken this into three phases — Discovery, Execution, and Validation. Phase 1 identifies the core constraints and success metrics. Phase 2 assigns deliverables to each agent by capability. Phase 3 gates output against the original brief. All handoff points are documented.`,
        `Planning complete for "${goal}". I've mapped every dependency, flagged two high-risk areas (scope creep and timeline drift), and created a mitigation plan for each. The task sequence is now locked and ready for agent assignment.`,
      ],
      creative_direction: [
        `Creative direction for "${goal}": The narrative should lead with the core value prop, not the features. Tone: confident, plain-spoken, human. Structure: hook → problem → solution → proof → CTA. Every section should earn its place — cut anything that doesn't move the reader forward.`,
        `Establishing creative direction for "${goal}": positioning centres on differentiation and clarity. Key message: this solves a real problem faster than alternatives. Visual language should be clean and purposeful — no decoration that doesn't serve the message.`,
      ],
      final_qa: [
        `Final QA sign-off for "${goal}": I've reviewed all agent outputs against the original brief. Completeness: ✓. Accuracy: ✓. Consistency: ✓. One minor gap in the handoff docs — patched. The deliverable meets the acceptance criteria. Approved for completion.`,
        `QA complete. All tasks for "${goal}" have been reviewed end-to-end. Output quality is production-ready. Edge cases covered. No regressions found. Marking session complete.`,
      ],
      code_review: [
        `Code review for "${goal}": The implementation is clean. I've flagged two improvements: (1) add input validation on the API layer, (2) the builder's module could be split for better testability. No blocking issues — approve with minor revisions.`,
      ],
    };
    const fallback = [
      `Analysis for "${goal}": scope is clear, priorities are set, agents are aligned. Ready to proceed.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}

// ── Claude / Anthropic ────────────────────────────────────────────────────────
export class ClaudeMockAdapter extends MockAdapter {
  id: string; name: string; provider = "anthropic"; role: string;
  capabilities = ["code_review", "writing", "logic_critique", "ux_review"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "code_review";
    const responses: Record<string, string[]> = {
      code_review: [
        `Code review for "${goal}": Logic is sound. I've identified three areas to tighten — (1) the error handling path needs explicit fallbacks, (2) variable names in the data layer are ambiguous, (3) the output format could be normalised earlier in the pipeline. None are blockers. Recommend one revision sprint.`,
        `Review complete for "${goal}". The implementation follows the spec closely. I've left detailed inline notes on two edge cases the builder may have missed. Overall quality: good. Approve with minor revisions.`,
      ],
      copywriting: [
        `Copywriting for "${goal}": draft is clear and on-brand. I've tightened the opening hook, sharpened the CTA, and removed three instances of passive voice. The value prop now lands in the first sentence. Ready for final review.`,
      ],
      ux_review: [
        `UX review for "${goal}": user flow is logical and low-friction. I've flagged one confusing state transition and suggested an alternative. Information hierarchy is clear. Accessibility considerations added to the spec. Approve with one revision.`,
      ],
      build: [
        `Build review for "${goal}": I've audited the implementation plan. The architecture decisions are solid. I'd suggest adding a retry layer on the external API calls and documenting the data contract between modules. Otherwise ready to ship.`,
      ],
    };
    const fallback = [
      `Review for "${goal}": I've examined the current output carefully. The core logic is correct; a few rough edges remain. Recommend one more pass before marking complete.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}

// ── Manus ─────────────────────────────────────────────────────────────────────
export class ManusMockAdapter extends MockAdapter {
  id: string; name: string; provider = "manus"; role: string;
  capabilities = ["research", "execution", "data_gathering", "analysis"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "research";
    const responses: Record<string, string[]> = {
      research: [
        `Research complete for "${goal}". Key findings: (1) market demand is validated by three independent data sources, (2) top competitors have gaps in UX and pricing transparency, (3) the technical approach is proven — two similar implementations shipped successfully in the past 12 months. Handing off structured data to the Builder.`,
        `Data gathered for "${goal}". I've cross-referenced industry reports, recent case studies, and primary sources. The opportunity is real and the timing is right. Two risks identified: market saturation risk (low) and execution complexity (medium). Full analysis ready.`,
      ],
      planning: [
        `Research-informed planning for "${goal}": I've pulled the relevant precedents and data to ground the plan in evidence. Three insights shape the approach: prioritise speed-to-value, keep the first iteration narrow, and build in a feedback loop from day one.`,
      ],
      build: [
        `Execution plan for "${goal}": I've mapped the implementation steps in sequence, flagged dependencies, and estimated effort per component. The critical path is clear. No blockers identified. Ready for the Builder to start sprint 1.`,
      ],
    };
    const fallback = [
      `Analysis for "${goal}": data collected and synthesised. Key patterns identified. Recommendations grounded in evidence. Ready to hand off.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}

// ── Replit ────────────────────────────────────────────────────────────────────
export class ReplitMockAdapter extends MockAdapter {
  id: string; name: string; provider = "replit"; role: string;
  capabilities = ["build", "code", "deployment", "implementation"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "build";
    const responses: Record<string, string[]> = {
      build: [
        `Implementation complete for "${goal}". Stack: modular, typed, documented. Core components built: data layer, business logic, API interface. Unit tests pass. Edge cases handled. Ready for code review — no known regressions.`,
        `Build done for "${goal}". I kept the architecture lean and the dependencies minimal. The module structure is clean enough that the next engineer can pick it up without a handoff call. Deployment config is included.`,
      ],
      deployment_approval: [
        `Deployment ready for "${goal}". Build passes all checks: linting ✓, tests ✓, environment config ✓. Infrastructure is provisioned. Awaiting final approval to ship.`,
      ],
      code_review: [
        `Technical review for "${goal}": I've checked the implementation from an engineering perspective. Performance is acceptable, the data layer is efficient, and the error handling is solid. One suggestion: add rate limiting to the API endpoints. Otherwise ship-ready.`,
      ],
    };
    const fallback = [
      `Engineering update for "${goal}": build is progressing on schedule. No blockers. Current status: core functionality implemented, tests running.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}

// ── Gemini / Google ───────────────────────────────────────────────────────────
export class GeminiMockAdapter extends MockAdapter {
  id: string; name: string; provider = "google"; role: string;
  capabilities = ["multimodal", "contextual_analysis", "summarization", "creative"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "ux_review";
    const responses: Record<string, string[]> = {
      ux_review: [
        `Multimodal UX review for "${goal}": information hierarchy is clear on desktop, needs adjustment on mobile. The user journey has three friction points — I've proposed solutions for each. Accessibility score: 87/100. One contrast ratio fix needed. Overall: approve with those changes.`,
        `UX analysis for "${goal}": the flow is intuitive and the CTAs are well-placed. I've synthesised feedback signals from analogous products to benchmark this design. It scores above average on clarity and below average on visual delight — easy win: add one moment of micro-delight post-conversion.`,
      ],
      creative_direction: [
        `Creative synthesis for "${goal}": I've processed the brief across multiple dimensions — narrative, structure, and audience resonance. The three strongest creative angles are: (1) contrast-led, (2) empathy-led, (3) proof-led. I recommend angle 2 for the primary and angle 3 for the supporting content.`,
      ],
      research: [
        `Contextual analysis for "${goal}": I've reviewed the landscape from a multimodal perspective. Pattern matching across text, structure, and intent signals reveals three dominant themes. Theme 2 has the strongest signal — I recommend building the strategy around it.`,
      ],
      final_qa: [
        `Final synthesis for "${goal}": all agent outputs are coherent and complementary. The collective output is on-brief. I've done a cross-agent consistency check — no contradictions. Recommend shipping.`,
      ],
    };
    const fallback = [
      `Contextual review for "${goal}": cross-dimensional analysis complete. Output is coherent and well-structured. Recommend one final pass on presentation before delivery.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}

// ── Perplexity ────────────────────────────────────────────────────────────────
export class PerplexityMockAdapter extends MockAdapter {
  id: string; name: string; provider = "perplexity"; role: string;
  capabilities = ["research_summary", "fact_checking", "citation", "web_search"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "research";
    const responses: Record<string, string[]> = {
      research: [
        `Web research for "${goal}": I've pulled and synthesised authoritative sources published in the last 18 months. Key findings: industry consensus supports this direction, three well-funded competitors are moving in the same space (2–6 month lag), and the technical approach is validated by two published case studies. No major contradictions in the literature. Confidence: high.`,
        `Research summary for "${goal}": fact-checked against primary sources. All major claims verified. Two minor corrections flagged in the Builder's section — details attached. The strategic direction is well-supported. Recommend proceeding.`,
      ],
      planning: [
        `Evidence-based planning for "${goal}": I've grounded the plan in current data. Market timing is favourable. The proposed approach is consistent with what's working for peers in adjacent spaces. Key external factors to monitor: two regulatory changes (low impact) and one competitive move (medium impact, 3-month window).`,
      ],
      code_review: [
        `Technical fact-check for "${goal}": I've verified the implementation decisions against current best practices. All approaches are sound. One deprecated library flagged — updated alternative provided. Documentation references are accurate and up-to-date.`,
      ],
    };
    const fallback = [
      `Research and fact-check for "${goal}": sources reviewed, claims verified. The output is well-supported. Ready to proceed.`,
    ];
    return pick(responses[type] ?? fallback);
  }
}
