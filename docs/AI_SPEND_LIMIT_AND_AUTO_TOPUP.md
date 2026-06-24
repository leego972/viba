# VIBA AI Spend Limit and Auto Top-Up Requirements

Financial logic must be treated as critical infrastructure. It must be deterministic, auditable, idempotent, fail-closed, and test-covered before production use.

This feature controls two different cost surfaces:

1. **Customer-facing VIBA credits** — what the user spends inside VIBA.
2. **Owner-facing provider spend** — what VIBA spends with OpenAI, Anthropic, Gemini, Perplexity, Replit, Manus, Railway reasoning, Groq, etc.

Customer credits alone do not protect the owner from external provider bills. Provider spend requires a separate kill-switch and budget-control layer.

## 1. Required user-facing behaviour

VIBA must support optional auto top-up with explicit consent.

The user must be able to configure:

```txt
autoTopUpEnabled: boolean
autoTopUpPackKey: credits_1000 | credits_2000 | credits_3000 | credits_4000 | credits_5000 | credits_6000
creditFloor: number
maxTopUpsPerBillingPeriod: number
billableExecutionLocked: boolean
```

Recommended defaults:

```txt
autoTopUpEnabled=false
autoTopUpPackKey=credits_1000
creditFloor=100
maxTopUpsPerBillingPeriod=1
billableExecutionLocked=false
```

Auto top-up must be opt-in. Never silently enable it.

## 2. Required commercial behaviour

1. User selects a plan or top-up pack.
2. User may optionally enable auto top-up.
3. User chooses the top-up amount and max automatic top-ups per billing period.
4. When credits fall below the configured floor, VIBA sends a warning email.
5. If auto top-up is enabled and the billing-period top-up cap has not been reached, VIBA attempts the authorised top-up.
6. If payment succeeds, credits are added and execution can continue.
7. If payment fails, billable AI execution is locked.
8. If max auto top-ups for the billing period is reached, billable AI execution is locked until manual top-up or plan upgrade.
9. Normal non-billable chat may remain free, but billable task execution must stop.

## 3. Required lock conditions

Billable AI execution must be blocked when any of these are true:

```txt
creditsRemaining <= 0
subscriptionStatus is none/canceled/past_due
billableExecutionLocked=true
unresolved payment failure exists
monthly/period auto-top-up cap reached and credits are below floor
provider global safe mode blocks the requested live provider
```

Expected API response:

```json
{
  "error": "billable_execution_locked",
  "message": "AI execution is locked until payment is completed or credits are topped up.",
  "billingUrl": "/billing"
}
```

## 4. Stripe rules

Use Stripe only through safe, auditable server-side flows.

Hard rules:

1. Never store raw card numbers.
2. Never charge off-session unless the user explicitly opted in and Stripe has an authorised payment method for that customer.
3. Every charge must have an idempotency key.
4. Every successful top-up must write a credit transaction once only.
5. Every failed payment must write an audit event and lock billable execution.
6. Webhook handlers must be idempotent and safe to replay.
7. Test mode and live mode IDs must never be mixed.

## 5. Stripe configuration requirements

Stripe must be configured for auto top-up before VIBA enables the UI.

Required Stripe setup:

1. Create all six one-time top-up prices.
2. Enable saved payment methods for subscribed customers.
3. Enable Billing Portal payment-method updates.
4. Confirm the checkout/subscription flow can create a reusable payment method for future off-session payments.
5. Configure webhook events for checkout, invoices, payment success, and payment failure.
6. Add metadata to every top-up price:

```txt
system=viba_billing
type=credit_pack
credits=<credit_amount>
packKey=credits_<credit_amount>
```

Auto top-up must use Stripe customer/payment method references only. It must never ask VIBA or Manus to collect raw card data.

## 6. Required email warnings

Send emails for:

1. Low credits warning.
2. Auto top-up attempted.
3. Auto top-up succeeded.
4. Auto top-up failed.
5. Billable execution locked.
6. Auto top-up period cap reached.

Each email must include:

```txt
current credits
reason for warning/charge/lock
auto top-up amount attempted
billing link: /billing
support path
```

## 7. Required Railway/env defaults

These env vars define safe platform defaults. User-level settings must still be stored in the database later.

```env
VIBA_BILLING_FAIL_CLOSED=true
VIBA_AUTO_TOPUP_DEFAULT_ENABLED=false
VIBA_AUTO_TOPUP_DEFAULT_PACK_KEY=credits_1000
VIBA_AUTO_TOPUP_DEFAULT_CREDIT_FLOOR=100
VIBA_AUTO_TOPUP_DEFAULT_MAX_PER_PERIOD=1
VIBA_AUTO_TOPUP_REQUIRE_PAYMENT_METHOD=true
VIBA_LOCK_BILLABLE_ON_PAYMENT_FAILURE=true
VIBA_PROVIDER_SPEND_SAFE_MODE=true
VIBA_PROVIDER_SPEND_MONTHLY_LIMIT_USD=100
VIBA_PROVIDER_SPEND_WARNING_USD=50
```

## 8. Provider-spend protection

For immediate safety on Railway:

```env
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
VIBA_BACKGROUND_MAX_TURNS=1
```

Controlled live testing:

```env
VIBA_COST_SAFE_MODE=false
VIBA_LIVE_AGENTS_ENABLED=true
VIBA_ALLOWED_LIVE_PROVIDERS=groq,openai
VIBA_BACKGROUND_MAX_TURNS=3
```

Do not enable all live providers at once.

## 9. Required database design

Add a durable billing-control table before enabling auto top-up:

```txt
user_billing_controls
- user_id
- auto_topup_enabled
- auto_topup_pack_key
- credit_floor
- max_topups_per_period
- topups_used_this_period
- billable_execution_locked
- lock_reason
- last_warning_sent_at
- last_payment_failure_at
- created_at
- updated_at
```

Add an idempotency ledger:

```txt
billing_idempotency_keys
- key
- user_id
- action_type
- stripe_object_id
- status
- created_at
```

Every top-up attempt must write an idempotency key before calling Stripe.

## 10. Required tests before production

Do not ship this feature without tests for:

1. Auto top-up disabled: no charge attempt.
2. Low credits with auto top-up enabled: one charge attempt.
3. Duplicate webhook replay: credits granted once only.
4. Payment failure: billable execution locked.
5. Manual top-up after failure: lock cleared only after confirmed payment.
6. Top-up cap reached: no further automatic charges.
7. Past-due subscription: billable execution locked.
8. Normal chat remains free.
9. Billable run-next/run-full fail closed on billing check errors.
10. Provider safe mode blocks live provider calls.

## 11. Launch rule

Auto top-up and provider-spend limits are not production-ready until all of the following are true:

```txt
Stripe live/test separation verified
webhook idempotency verified
credit transaction idempotency verified
email warnings verified
billable execution lock verified
manual unlock/payment recovery verified
Railway env vars configured
provider safe mode tested
```

If any item is not verified, keep:

```env
VIBA_AUTO_TOPUP_DEFAULT_ENABLED=false
VIBA_COST_SAFE_MODE=true
VIBA_LIVE_AGENTS_ENABLED=false
```
