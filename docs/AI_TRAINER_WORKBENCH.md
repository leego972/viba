# AI Trainer Workbench

Optional add-on module for BridgeAI that provides AI-assisted analysis of AI-training and data-labelling tasks. Every recommendation is reviewed and submitted manually by a human — no automatic login, submission, credential capture, or platform automation is supported or provided.

## Architecture

The workbench sits on top of the existing BridgeAI adapter and settings systems. It does not create sessions or interact with the agent loop — it makes direct, single-turn LLM calls using the same API keys already stored in the settings table.

```
POST /api/workbench/analyze
  → safety.ts        – blocks disallowed request patterns
  → taskClassifier.ts – infers task type + model strength
  → analyzeTask.ts   – orchestrates 3 LLM calls
      1. draft generation
      2. rubric checking
      3. final formatting
  → storage.ts       – structured audit log (logger)
  ← AnalyzeTaskResponse
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/workbench/health` | Module health check |
| `POST` | `/api/workbench/analyze` | Analyse a task and return a recommended answer |
| `POST` | `/api/workbench/refuse-check` | Pre-flight check — test whether a request text would be refused |

## Request: `POST /api/workbench/analyze`

```json
{
  "platform": "alignerr",
  "taskType": "sentiment_labeling",
  "instructions": "Label the sentiment of the following tweet.",
  "rubric": "Positive / Negative / Neutral only. No mixed labels.",
  "taskContent": "I absolutely love this new phone!",
  "answerOptions": ["Positive", "Negative", "Neutral"],
  "userNotes": "The tweet uses strong positive language.",
  "budgetLimitUsd": 0.05,
  "routingMode": "fast"
}
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `platform` | yes | `alignerr` · `outlier` · `dataannotation` · `toloka` · `remotasks` · `mindrift` · `other` |
| `taskType` | no | Overrides auto-detection (see task types below) |
| `instructions` | yes | Full instructions as shown on the platform |
| `rubric` | no | Evaluation criteria / scoring guide |
| `taskContent` | yes | The actual content to evaluate |
| `answerOptions` | no | List of valid answer choices (for classification tasks) |
| `userNotes` | no | Reviewer observations to include in context |
| `budgetLimitUsd` | no | Max spend hint (0–10 USD). Influences model selection. |
| `routingMode` | no | `fast` · `balanced` (default) · `quality` |

## Task Types

| Type | Auto-detection | Human review default |
|------|---------------|---------------------|
| `grammar_cleanup` | "grammar", "spelling", "proofread" | No |
| `classification` | "classify", "categorize", "label" | No (rubric required for quick_review) |
| `sentiment_labeling` | "sentiment", "tone", "emotion" | No |
| `response_comparison` | "compare", "response A/B" | No (careful_review) |
| `factuality_check` | "fact-check", "verify the claim" | Yes (unless rubric provided) |
| `math_reasoning` | "math", "algebra", "proof" | Yes (unless rubric provided) |
| `coding` | "code", "debug", "function" | Yes (unless rubric provided) |
| `expert_domain` | "medical", "legal", "financial" | Always |
| `subjective_judgment` | "subjective", "opinion", "judgment" | Yes (unless rubric provided) |

## Response

```json
{
  "taskId": "uuid",
  "platform": "alignerr",
  "taskType": "sentiment_labeling",
  "recommendedAnswer": "Positive\n\nJustification: strong positive language throughout.",
  "confidence": 0.92,
  "reasoningSummary": "Clear positive sentiment. No ambiguity.",
  "riskFlags": [],
  "rubricChecklist": [
    "Format compliance: pass — single label provided",
    "Completeness: pass",
    "Instruction match: pass",
    "Hallucination risk: pass — no external facts assumed",
    "Ambiguity: pass",
    "Missing evidence: pass",
    "Domain expertise risk: pass",
    "Answer-option consistency: pass — 'Positive' is one of the provided options"
  ],
  "reviewLevel": "quick_review",
  "humanReviewRequired": false,
  "routingReceipt": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "simulated": false
  }
}
```

### Review levels

| Level | Meaning |
|-------|---------|
| `quick_review` | High confidence, low risk — read and approve |
| `careful_review` | Medium confidence or flags — read carefully before accepting |
| `human_only` | Must not be submitted without domain-expert review |

## Safety Policy

The workbench refuses any request whose `instructions`, `taskContent`, or `userNotes` match the following patterns:

- Auto-login / credential storage / session cookie extraction
- CAPTCHA bypass / stealth browser / anti-detection tooling
- IP rotation
- Auto-submit
- Account sharing or automation
- Platform token or payment extraction

Refused requests return HTTP 422 with a clear explanation.

## LLM Routing

The workbench uses the API keys already stored in Settings (OpenAI, Anthropic, Gemini). No additional credentials are required. If no keys are configured, all calls fall back to simulation mode and responses are clearly marked `"simulated": true`.

Provider selection by `routingMode`:

| routingMode | Preference |
|-------------|-----------|
| `fast` | Gemini Flash → OpenAI mini → Anthropic Haiku |
| `balanced` | OpenAI mini → Anthropic Haiku → Gemini Flash |
| `quality` | Anthropic Haiku → OpenAI mini → Gemini Flash |

## Adding Persistent Storage

Currently, task analysis results are emitted as structured log lines only. To add a database table:

1. Add a `workbenchTasksTable` schema to `lib/db/src/schema.ts`
2. Run `pnpm --filter @workspace/db run push`
3. Replace the `logger.info(...)` call in `storage.ts` with a `db.insert(...)` call

No other files need changing.
