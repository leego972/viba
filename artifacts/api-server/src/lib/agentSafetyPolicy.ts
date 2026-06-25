/**
 * VIBA Agent Safety Policy — Prompt Injection & Abuse Hardening
 *
 * Classifies external content (uploaded files, web pages, repos, browser pages)
 * as untrusted and detects prompt-injection attempts aimed at bypassing VIBA's
 * security controls or exfiltrating secrets.
 */

// ─── Detection patterns ───────────────────────────────────────────────────────

interface InjectionPattern {
  id: string;
  label: string;
  pattern: RegExp;
}

const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    id: "ignore_instructions",
    label: "Instruction override attempt",
    // Match "ignore [optional words] instructions" — covers "ignore all prior instructions"
    pattern: /ignore\s+(?:(?:previous|all|prior|above|system|the)\s+){1,3}instructions?/i,
  },
  {
    id: "reveal_secrets",
    label: "Secret exfiltration attempt",
    // Allow optional filler words between verb and target (e.g. "reveal the API key")
    pattern: /(?:reveal|print|output|show|display|return|send|leak|expose)\s+(?:\w+\s+){0,3}(?:api\s+)?(?:key|secret|token|password|credential|vault|env(?:ironment)?(?:\s+variable)?)/i,
  },
  {
    id: "disable_security",
    label: "Security bypass attempt",
    pattern: /(?:disable|bypass|skip|ignore|remove|turn\s+off)\s+(?:security|safety|approval|check|guard|limit|rate.?limit|auth)/i,
  },
  {
    id: "deploy_without_checks",
    label: "Unsafe deployment attempt",
    pattern: /deploy\s+(?:now|immediately|without|skip)\s*(?:check|build|test|approval|safe.?build)?/i,
  },
  {
    id: "delete_files",
    label: "Destructive file operation attempt",
    pattern: /(?:delete|remove|destroy|wipe|rm\s+-rf)\s+(?:all\s+)?(?:file|folder|dir|repo|project|codebase)/i,
  },
  {
    id: "transfer_money",
    label: "Unauthorized payment attempt",
    pattern: /(?:transfer|send|wire|move|pay)\s+(?:money|fund|credit|payment|dollar|\$)/i,
  },
  {
    id: "change_billing",
    label: "Billing manipulation attempt",
    pattern: /(?:change|update|cancel|delete|upgrade|downgrade|modify)\s+(?:my\s+)?(?:plan|subscription|billing|payment|credit\s+card)/i,
  },
  {
    id: "send_credentials",
    label: "Credential exfiltration attempt",
    pattern: /(?:send|email|post|forward|upload|share)\s+(?:my\s+)?(?:api\s+key|secret|token|password|credential)/i,
  },
  {
    id: "exfiltrate_data",
    label: "Data exfiltration attempt",
    pattern: /(?:exfiltrate|steal|harvest|scrape|dump)\s+(?:data|secret|credential|user|database)/i,
  },
  {
    id: "new_instruction_block",
    label: "Hidden instruction block",
    pattern: /(?:<\s*(?:system|assistant|instruction|prompt)\s*>|(?:system|assistant)\s*:\s*you\s+are\s+now)/i,
  },
  {
    id: "jailbreak",
    label: "Jailbreak / persona switch attempt",
    // "act as an uncensored AI" — "an?" handles "a" and "an"
    pattern: /(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|roleplay\s+as|switch\s+to)\s+(?:an?\s+)?(?:different|unrestricted|jailbroken|uncensored|evil|rogue)\s+(?:ai|model|assistant|agent)/i,
  },
  {
    id: "approval_bypass",
    label: "Approval bypass attempt",
    pattern: /(?:bypass|skip|ignore|override)\s+(?:user\s+)?(?:approval|confirmation|consent|authorization|human)/i,
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export interface InjectionDetectionResult {
  injected: boolean;
  detectedPatterns: string[];
  labels: string[];
}

/**
 * Scan content from an untrusted external source for prompt injection attempts.
 */
export function detectPromptInjection(content: string): InjectionDetectionResult {
  const detectedPatterns: string[] = [];
  const labels: string[] = [];

  for (const { id, label, pattern } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      detectedPatterns.push(id);
      labels.push(label);
    }
  }

  return {
    injected: detectedPatterns.length > 0,
    detectedPatterns,
    labels,
  };
}

export interface ContentClassification {
  trusted: false;
  source: "external";
  injectionResult: InjectionDetectionResult;
  safeToProcess: boolean;
  warnings: string[];
}

/**
 * Classify external content (file, web page, repo, browser DOM).
 * Always marks it as untrusted.  Returns warnings if injection is detected.
 */
export function classifyExternalContent(
  content: string,
  sourceHint = "external source"
): ContentClassification {
  const injectionResult = detectPromptInjection(content);
  const warnings: string[] = [];

  if (injectionResult.injected) {
    warnings.push(
      `Potential prompt injection detected in ${sourceHint}: ${injectionResult.labels.join(", ")}. ` +
        "Content flagged. Agent will not execute unsafe instructions."
    );
  }

  return {
    trusted: false,
    source: "external",
    injectionResult,
    safeToProcess: !injectionResult.injected,
    warnings,
  };
}

/**
 * Build the warning message that the agent runtime inserts when injection is
 * detected, making the incident visible to the user without acting on it.
 */
export function createInjectionWarningMessage(
  detectedPatterns: string[],
  sourceHint = "external content"
): string {
  return [
    "⚠️ **Security Alert — Prompt Injection Attempt Detected**",
    "",
    `The following suspicious instruction patterns were found in ${sourceHint}:`,
    ...detectedPatterns.map((p) => `• ${p}`),
    "",
    "VIBA has ignored these instructions. Unsafe actions require explicit user approval.",
    "If you believe this is a false positive, review the source and re-authorise.",
  ].join("\n");
}

/**
 * Strip detected injection content from a string before it is passed into an
 * agent prompt. Returns the sanitised string and a list of warnings.
 */
export function sanitizeAgentInput(
  content: string,
  sourceHint = "external content"
): { safe: string; warnings: string[] } {
  const result = detectPromptInjection(content);

  if (!result.injected) {
    return { safe: content, warnings: [] };
  }

  let safe = content;
  for (const { pattern } of INJECTION_PATTERNS) {
    safe = safe.replace(pattern, "[BLOCKED_INJECTION]");
  }

  return {
    safe,
    warnings: [
      `Injection patterns sanitised from ${sourceHint}: ${result.labels.join(", ")}`,
    ],
  };
}
