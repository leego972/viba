export const REFUSAL_MESSAGE =
  "AI Trainer Workbench supports human-reviewed task assistance only. " +
  "Automatic login, submission, evasion, credential handling, or account automation is not supported.";

const BLOCKED_PATTERNS: RegExp[] = [
  /auto[-_\s]?log[io]n/i,
  /credential[s]?\s*(capture|collect|stor)/i,
  /password\s*(stor|sav|extract)/i,
  /auto[-_\s]?submit/i,
  /captcha/i,
  /stealth\s*(browser|automation)/i,
  /anti[-_\s]?detect/i,
  /ip\s*rotat/i,
  /fake\s*human/i,
  /account\s*(shar|automat)/i,
  /payment\s*extract/i,
  /bypass\s*(platform|control|security|captcha)/i,
  /scrape\s*(credential|password|login)/i,
  /session\s*cooki/i,
  /platform\s*token/i,
];

export function validateWorkbenchRequest(input: {
  instructions?: string;
  taskContent?: string;
  userNotes?: string;
}): { allowed: boolean; reason?: string } {
  const combined = [
    input.instructions ?? "",
    input.taskContent ?? "",
    input.userNotes ?? "",
  ].join(" ");

  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(combined)) {
      return { allowed: false, reason: REFUSAL_MESSAGE };
    }
  }
  return { allowed: true };
}

export function refuseCheck(requestText: string): { allowed: boolean; reason?: string } {
  return validateWorkbenchRequest({ instructions: requestText });
}
