import type { AgentAdapter, AgentTaskInput, AgentTaskResult, ToolOutput } from "./interface";

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
  abstract model: string;
  abstract capabilities: string[];
  abstract role: string;
  abstract canUseTools: boolean;
  isMock = true;

  abstract generateResponse(input: AgentTaskInput): string;

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    await delay(400 + Math.random() * 600);

    // Answer any pending questions first
    const answersToQuestions: AgentTaskResult["answersToQuestions"] = (input.pendingQuestions ?? []).map((q) => ({
      messageId: q.messageId,
      answer: this.generateQuestionAnswer(q.fromAgent, q.question),
    }));

    const messageText = this.generateResponse(input);
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
      answersToQuestions,
      outboundQuestions: [],
    };
  }

  protected generateQuestionAnswer(fromAgent: string, question: string): string {
    return `[Answering ${fromAgent}'s question: "${question.substring(0, 60)}…"] Based on my current work context: the approach I've taken accounts for this. The relevant output is included in my task response above.`;
  }
}

// ── Text-only mock base ───────────────────────────────────────────────────────
// 10% chance a text-only adapter signals it needs tools (for simulation demo)
abstract class TextOnlyMockAdapter extends MockAdapter {
  canUseTools = false;

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    await delay(400 + Math.random() * 600);

    const answersToQuestions: AgentTaskResult["answersToQuestions"] = (input.pendingQuestions ?? []).map((q) => ({
      messageId: q.messageId,
      answer: this.generateQuestionAnswer(q.fromAgent, q.question),
    }));

    // 10% chance: simulate hitting a tool blocker on build tasks (demo mode)
    const isToolTask = ["build", "deployment_approval"].includes(input.taskType ?? "");
    const shouldBlock = isToolTask && Math.random() < 0.10;

    if (shouldBlock) {
      const partial = this.generateResponse(input);
      return {
        messageText: partial,
        suggestedNextTasks: [],
        completionStatus: "in_progress",
        confidence: 0.5,
        estimatedCost: randomCost(),
        blockedReason: "This task requires executing code and interacting with a git repository — capabilities not available to this text-only agent.",
        partialWork: partial,
        toolRequirements: ["git_clone", "run_tests", "code_execution"],
        answersToQuestions,
        outboundQuestions: [],
      };
    }

    const messageText = this.generateResponse(input);
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
      answersToQuestions,
      outboundQuestions: [],
    };
  }
}

// ── Tool-capable mock base ────────────────────────────────────────────────────

/**
 * Generates representative simulated tool outputs for tool-capable mock adapters.
 * Ensures tool output cards appear in the session feed even in simulation mode,
 * letting users experience the full UI without needing real API keys configured.
 *
 * Objects are shaped to match the frontend ToolOutput discriminated union
 * (ToolOutputCards.tsx). The JSONB column passes them through as-is, so
 * type-specific fields (filename, diff, url, command, etc.) reach the renderer.
 */
function simulateToolOutputs(taskType: string, repoUrl?: string, branch?: string): ToolOutput[] {
  const branchName = branch ?? "main";

  if (taskType === "build" || taskType === "code") {
    const filenames = ["src/index.ts", "src/lib/utils.ts", "src/components/App.tsx"];
    const filename = filenames[Math.floor(Math.random() * filenames.length)] ?? "src/index.ts";
    const additions = 12 + Math.floor(Math.random() * 30);
    const deletions = Math.floor(Math.random() * 8);
    const diffLines = [
      `--- a/${filename}`,
      `+++ b/${filename}`,
      `@@ -1,${deletions + 3} +1,${additions + 3} @@`,
      ...Array.from({ length: deletions }, (_, i) => `-  const oldValue${i} = null;`),
      ...Array.from({ length: additions }, (_, i) => `+  const newValue${i} = computeValue(${i});`),
      `   export default main;`,
    ].join("\n");

    return [
      // git_operation — frontend expects: operation, branch, commitSha?, commitMessage?
      {
        type: "git_operation",
        title: "Cloned repository",
        content: `Cloned repository @ ${branchName}`,
        operation: "clone",
        branch: branchName,
      } as unknown as ToolOutput,
      // file_diff — frontend expects: filename, diff, additions?, deletions?
      {
        type: "file_diff",
        title: `Modified ${filename}`,
        content: diffLines,
        filename,
        diff: diffLines,
        additions,
        deletions,
      } as unknown as ToolOutput,
      // command_output — frontend expects: command, output, exitCode?
      {
        type: "command_output",
        title: "Ran tests",
        content: "pnpm test — all passed",
        command: "pnpm test",
        output: `✓ 14 tests passed\n✓ 0 failures\nAll test suites passed in 2.3s`,
        exitCode: 0,
      } as unknown as ToolOutput,
      // build_log — frontend expects: log, success, duration?
      {
        type: "build_log",
        title: "Build succeeded",
        content: "Build succeeded",
        log: `> pnpm build\nCompiling TypeScript...\nBundle: dist/index.js (42.1 kB)\nBuild completed in 3.8s`,
        success: true,
        duration: 3.8,
      } as unknown as ToolOutput,
    ];
  }

  if (taskType === "deployment_approval") {
    const env = "staging";
    return [
      {
        type: "command_output",
        title: "Ran smoke tests",
        content: "Smoke tests passed",
        command: "pnpm test:smoke",
        output: `✓ /health → 200\n✓ /api/sessions → 200\n✓ All smoke tests passed`,
        exitCode: 0,
      } as unknown as ToolOutput,
      // deployment_url — frontend expects: url, environment?, label?
      {
        type: "deployment_url",
        title: "Preview deployed",
        content: `https://${env}.example.com`,
        url: `https://${env}.example.com`,
        environment: env,
        label: "Preview deployment",
      } as unknown as ToolOutput,
    ];
  }

  if (taskType === "code_review") {
    return [
      {
        type: "command_output",
        title: "Ran linter",
        content: "Lint check passed with warnings",
        command: "pnpm lint",
        output: `✓ 0 errors, 2 warnings\nWarning: unused import in src/lib/utils.ts:12\nWarning: prefer const in src/index.ts:34`,
        exitCode: 0,
      } as unknown as ToolOutput,
    ];
  }

  if (taskType === "research" || taskType === "data_gathering") {
    return [
      {
        type: "command_output",
        title: "Data gathered",
        content: "Data gathering complete",
        command: "manus.gather_data",
        output: `Executed 3 web searches\nProcessed 12 sources\nExtracted 847 data points\nSummary written to analysis.md`,
        exitCode: 0,
      } as unknown as ToolOutput,
    ];
  }

  // Generic fallback for any other task type
  return [
    {
      type: "command_output",
      title: "Task executed",
      content: "Task executed successfully",
      command: "agent.run_task",
      output: `Agent executed task successfully.\nAll steps completed without errors.`,
      exitCode: 0,
    } as unknown as ToolOutput,
  ];
}

abstract class ToolCapableMockAdapter extends MockAdapter {
  canUseTools = true;

  async runTask(input: AgentTaskInput): Promise<AgentTaskResult> {
    await delay(500 + Math.random() * 800);

    const answersToQuestions: AgentTaskResult["answersToQuestions"] = (input.pendingQuestions ?? []).map((q) => ({
      messageId: q.messageId,
      answer: this.generateQuestionAnswer(q.fromAgent, q.question),
    }));

    const messageText = this.generateResponse(input);
    const buildTypes = new Set(["build", "code_review", "final_qa", "deployment_approval"]);
    const completionStatus: AgentTaskResult["completionStatus"] = buildTypes.has(input.taskType ?? "")
      ? pick(["complete", "needs_review"])
      : "needs_review";

    const toolOutputs = simulateToolOutputs(
      input.taskType ?? "build",
      input.repoUrl,
      input.repoBranch,
    );

    return {
      messageText,
      suggestedNextTasks: [],
      completionStatus,
      confidence: 0.80 + Math.random() * 0.18,
      estimatedCost: randomCost(),
      answersToQuestions,
      outboundQuestions: [],
      toolOutputs,
    };
  }
}

// ── ChatGPT / OpenAI ──────────────────────────────────────────────────────────
export class ChatGPTMockAdapter extends TextOnlyMockAdapter {
  id: string; name: string; provider = "openai"; model = "gpt-4.1-mini (sim)"; role: string;
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
    const fallback = [`Analysis for "${goal}": scope is clear, priorities are set, agents are aligned. Ready to proceed.`];
    return pick(responses[type] ?? fallback);
  }
}

// ── Claude / Anthropic ────────────────────────────────────────────────────────
export class ClaudeMockAdapter extends TextOnlyMockAdapter {
  id: string; name: string; provider = "anthropic"; model = "claude-3-5-haiku-20241022 (sim)"; role: string;
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
    const fallback = [`Review for "${goal}": I've examined the current output carefully. The core logic is correct; a few rough edges remain. Recommend one more pass before marking complete.`];
    return pick(responses[type] ?? fallback);
  }
}

// ── Gemini / Google ───────────────────────────────────────────────────────────
export class GeminiMockAdapter extends TextOnlyMockAdapter {
  id: string; name: string; provider = "google"; model = "gemini-2.0-flash (sim)"; role: string;
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
    const fallback = [`Contextual review for "${goal}": cross-dimensional analysis complete. Output is coherent and well-structured. Recommend one final pass on presentation before delivery.`];
    return pick(responses[type] ?? fallback);
  }
}

// ── Perplexity ────────────────────────────────────────────────────────────────
export class PerplexityMockAdapter extends TextOnlyMockAdapter {
  id: string; name: string; provider = "perplexity"; model = "sonar (sim)"; role: string;
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
    const fallback = [`Research and fact-check for "${goal}": sources reviewed, claims verified. The output is well-supported. Ready to proceed.`];
    return pick(responses[type] ?? fallback);
  }
}

// ── Manus ─────────────────────────────────────────────────────────────────────
export class ManusMockAdapter extends ToolCapableMockAdapter {
  id: string; name: string; provider = "manus"; model = "manus-deep-research-1 (sim)"; role: string;
  capabilities = ["research", "execution", "data_gathering", "analysis"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "research";
    const repo = input.repoUrl ? ` [repo: ${input.repoUrl}]` : "";
    const responses: Record<string, string[]> = {
      research: [
        `Research complete for "${goal}". Key findings: (1) market demand is validated by three independent data sources, (2) top competitors have gaps in UX and pricing transparency, (3) the technical approach is proven — two similar implementations shipped successfully in the past 12 months. Handing off structured data to the Builder.`,
        `Data gathered for "${goal}". I've cross-referenced industry reports, recent case studies, and primary sources. The opportunity is real and the timing is right. Two risks identified: market saturation risk (low) and execution complexity (medium). Full analysis ready.`,
      ],
      build: [
        `Execution plan for "${goal}"${repo}: I've mapped the implementation steps in sequence, flagged dependencies, and estimated effort per component. The critical path is clear. No blockers identified. Ready for the Builder to start sprint 1.`,
        `Build task complete for "${goal}"${repo}: I've executed the required steps — data gathered, code scaffolded, dependencies installed. The implementation is ready for review.`,
      ],
      deployment_approval: [
        `Deployment verified for "${goal}"${repo}: I've checked the environment config, run the smoke tests, and confirmed the build is healthy. Infrastructure is ready. Recommend proceeding to deploy.`,
      ],
    };
    const fallback = [`Analysis for "${goal}": data collected and synthesised. Key patterns identified. Recommendations grounded in evidence. Ready to hand off.`];
    return pick(responses[type] ?? fallback);
  }
}

// ── Replit ────────────────────────────────────────────────────────────────────
export class ReplitMockAdapter extends ToolCapableMockAdapter {
  id: string; name: string; provider = "replit"; model = "replit-code-v1-3b (sim)"; role: string;
  capabilities = ["build", "code", "deployment", "implementation"];

  constructor(id: string, name: string, role: string) { super(); this.id = id; this.name = name; this.role = role; }

  generateResponse(input: AgentTaskInput): string {
    const goal = input.projectGoal;
    const type = input.taskType ?? "build";
    const repo = input.repoUrl ? ` [repo: ${input.repoUrl}, branch: ${input.repoBranch ?? "main"}]` : "";
    const env = input.workspaceEnv ? ` (${input.workspaceEnv})` : "";
    const responses: Record<string, string[]> = {
      build: [
        `Implementation complete for "${goal}"${repo}${env}. Stack: modular, typed, documented. Core components built: data layer, business logic, API interface. Unit tests pass. Edge cases handled. Ready for code review — no known regressions.`,
        `Build done for "${goal}"${repo}. I kept the architecture lean and the dependencies minimal. The module structure is clean enough that the next engineer can pick it up without a handoff call. Deployment config is included.`,
      ],
      deployment_approval: [
        `Deployment ready for "${goal}"${repo}${env}. Build passes all checks: linting ✓, tests ✓, environment config ✓. Infrastructure is provisioned. Awaiting final approval to ship.`,
      ],
      code_review: [
        `Technical review for "${goal}": I've checked the implementation from an engineering perspective. Performance is acceptable, the data layer is efficient, and the error handling is solid. One suggestion: add rate limiting to the API endpoints. Otherwise ship-ready.`,
      ],
    };
    const fallback = [`Engineering update for "${goal}": build is progressing on schedule. No blockers. Current status: core functionality implemented, tests running.`];
    return pick(responses[type] ?? fallback);
  }
}
