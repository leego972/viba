# VIBA Credentials, Connections, and Logs

## Scope

VIBA now has an encrypted reusable key vault for API keys and access tokens.

The goal is that users should not need to paste the same keys every time.

## Storage rule

VIBA checks credentials in this order:

1. Environment variables
2. Encrypted saved VIBA credentials
3. Missing-key response naming the exact key that must be replaced or added

Secrets are not returned by API responses.

## Required encryption variable

Set at least one of:

```env
CREDENTIAL_ENCRYPTION_KEY=
MASTER_ENCRYPTION_KEY=
SESSION_SECRET=
```

Recommended production setting:

```env
CREDENTIAL_ENCRYPTION_KEY=<strong random 32+ character value>
```

## Credential routes

```txt
GET  /api/credentials/status
GET  /api/credentials/required
POST /api/credentials/save
POST /api/credentials/validate
GET  /api/credentials/:provider/current
POST /api/credentials/browser-profile-note
GET  /api/viba/logs
```

## Providers

```txt
github
railway
railway_mcp
openai
anthropic
gemini
perplexity
groq
replit
manus
```

## Example save request

```json
{
  "provider": "github",
  "kind": "token",
  "value": "github_pat_or_token_here",
  "label": "default"
}
```

## Example validation request

```json
{
  "provider": "github",
  "kind": "token",
  "label": "default"
}
```

If a key is wrong, VIBA returns the key that must be replaced, such as:

```json
{
  "ok": false,
  "provider": "github",
  "message": "GITHUB_TOKEN rejected by GitHub. Replace GITHUB_TOKEN."
}
```

## GitHub

Preferred:

```env
GITHUB_TOKEN=
```

Saved fallback:

```txt
provider=github
kind=token
```

## Railway

Preferred:

```env
RAILWAY_TOKEN=
```

Saved fallback:

```txt
provider=railway
kind=token
```

## Railway MCP

Preferred:

```env
RAILWAY_MCP_URL=
RAILWAY_TOKEN=
```

Saved fallback:

```txt
provider=railway_mcp
kind=url
provider=railway
kind=token
```

## Browser access

API tokens are the preferred and safer method for GitHub and Railway.

Browser-based access should only be used for accounts the user owns and should be supervised. VIBA must not bypass MFA, CAPTCHA, or platform security checks.

## Activity logging

The vault creates a structured activity log table:

```txt
viba_activity_logs
```

This table is intended to record:

```txt
credential_saved
credential_validated
connection_validated
browser_audit
scan_started
scan_completed
bug_found
fix_proposed
fix_applied
build_started
build_failed
build_passed
deploy_started
deploy_failed
deploy_passed
approval_requested
approval_granted
approval_rejected
```

Current implemented route:

```txt
GET /api/viba/logs
```

Next wiring step: existing scan, build, repair and deploy actions should call `logVibaEvent()` at every important state transition.
