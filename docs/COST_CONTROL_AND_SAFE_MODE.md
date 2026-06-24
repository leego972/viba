# VIBA Cost Control and Safe Mode

This file exists because live AI/tool providers can create a large external provider bill quickly. User-facing credits are not the same as provider spend control. Credits decide what users consume inside VIBA; cost controls decide what VIBA is allowed to spend with OpenAI, Anthropic, Gemini, Perplexity, Replit, Manus, Railway reasoning, Groq, etc.

## Immediate Railway safety settings

Until production billing, budget caps, and Doctor escalation gates are fully verified, set these variables in Railway:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=3
```

Effect:

- Live providers are forced into simulation/mock mode.
- Expensive agent API calls are blocked even if API keys exist.
- Background full-run cannot run many turns while testing.

## Controlled live testing

When ready to test real providers, do **not** enable everything at once. Use an allow-list.

Example: allow only Groq and Ollama:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,ollama
VIBA_BACKGROUND_MAX_TURNS=5
```

Example: test OpenAI only:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=openai
VIBA_BACKGROUND_MAX_TURNS=3
```

When `VIBA_ALLOWED_LIVE_PROVIDERS` is set, every provider not listed falls back to simulation mode.

## Safe mode with local Ollama

If local Ollama is available and should be allowed during safe mode:

```env
VIBA_COST_SAFE_MODE=true
VIBA_ALLOW_OLLAMA_IN_SAFE_MODE=true
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
```

Only use this when the Railway/deployment environment can actually reach the Ollama host.

## Provider-cost policy

Use this order for the GitHub/Railway Doctor and other heavy workflows:

1. Deterministic checks first: repo files, lockfile/package mismatch, workflow config, env-var presence, route registration, health endpoint, public HTTP checks.
2. Cheap log parsing second: inspect errors and classify without calling an expensive model.
3. Low-cost model only if needed: one concise summarisation/triage pass.
4. Expensive model or repair agent only after:
   - credit quote is shown,
   - provider-cost warning is shown,
   - session budget cap is set,
   - user explicitly approves escalation.
5. Mutating actions must remain owner-approved: GitHub PR creation, merge, Railway mutation, env changes, deploy/redeploy.

## Hard rules

- Do not run autonomous full-run against live expensive providers without a session budget cap.
- Do not let Doctor mode call paid agents for basic deterministic checks.
- Do not combine background mode + all live provider keys + high turn limit.
- Do not rely on VIBA credits alone to control external API spend.
- Do not expose provider keys or Railway secrets in Doctor reports.

## Recommended production defaults

For first production launch:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=10
```

Then raise limits only after real usage data shows safe spend.

## Emergency shutdown

If provider spend spikes again, set these immediately in Railway and redeploy:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=1
```

This should stop live provider calls while keeping the product accessible for non-live testing, billing, and deterministic diagnostics.
