# Environment Variables

All variables are optional unless marked **required**. Restart the API server after changing any value.

## Circuit Breaker

| Variable | Default | Description |
|---|---|---|
| `CIRCUIT_OPEN_THRESHOLD` | `5` | Number of consecutive failures before the circuit breaker opens for a provider and live calls are bypassed in favour of simulation. |
| `CIRCUIT_TIMEOUT_MS` | `300000` (5 minutes) | How long (in milliseconds) the circuit stays open before allowing a half-open probe attempt. |

### Example

```
# Trip the circuit after 3 failures instead of 5
CIRCUIT_OPEN_THRESHOLD=3

# Reset after 2 minutes instead of 5
CIRCUIT_TIMEOUT_MS=120000
```

## Database

| Variable | Description |
|---|---|
| `DATABASE_URL` | **Required.** PostgreSQL connection string used by the API server and DB library. |

## API Keys

| Variable | Description |
|---|---|
| `ANTHROPIC_API_KEY` | API key for the Anthropic (Claude) provider. |
| `OPENAI_API_KEY` | API key for the OpenAI provider. |
| `GOOGLE_API_KEY` | API key for the Google (Gemini) provider. |
