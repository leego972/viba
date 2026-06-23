# Manus Stripe Price Setup — VIBA / Bridge AI

Create these Stripe products and prices before or during Railway production setup. Use **Stripe live mode** for production. Use **test mode** only for staging.

Do not commit Stripe secrets or price IDs into source code. After creating the prices, copy the resulting `price_...` IDs into Railway environment variables.

## 1. Required Stripe API keys

In Stripe Dashboard, copy:

```env
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
```

Set both in Railway.

## 2. Create subscription products and recurring prices

Create these recurring monthly prices in Stripe.

| Product name | Billing type | Price | Credits | Railway env var |
|---|---|---:|---:|---|
| `VIBA Member Monthly` | Recurring monthly | USD $50/month | 1,500/month | `STRIPE_BILLING_SUBSCRIPTION_PRICE_ID` |
| `VIBA Pro Monthly` | Recurring monthly | USD $150/month | 6,000/month | `STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID` |

### 2.1 Member product metadata

Set metadata on the **product** and/or **price**:

```txt
system=viba_billing
type=subscription
planKey=viba_member
credits=1500
trialDailyCredits=500
```

After creating the price, copy the Member `price_...` ID into Railway:

```env
STRIPE_BILLING_SUBSCRIPTION_PRICE_ID=price_...
STRIPE_PRICE_ID=price_...
```

`STRIPE_PRICE_ID` is legacy compatibility. Set it to the same Member price ID unless the legacy Stripe routes have been removed.

### 2.2 Pro product metadata

Set metadata on the **product** and/or **price**:

```txt
system=viba_billing
type=subscription
planKey=viba_pro
credits=6000
trialDailyCredits=500
```

After creating the price, copy the Pro `price_...` ID into Railway:

```env
STRIPE_BILLING_PRO_SUBSCRIPTION_PRICE_ID=price_...
```

## 3. Create one-time top-up products and prices

Create these one-time payment prices in Stripe.

| Product name | Billing type | Price | Credits | Railway env var |
|---|---|---:|---:|---|
| `VIBA 1,000 Credit Pack` | One-time | USD $50 | 1,000 | `STRIPE_BILLING_CREDITS_1000_PRICE_ID` |
| `VIBA 2,000 Credit Pack` | One-time | USD $100 | 2,000 | `STRIPE_BILLING_CREDITS_2000_PRICE_ID` |
| `VIBA 3,000 Credit Pack` | One-time | USD $150 | 3,000 | `STRIPE_BILLING_CREDITS_3000_PRICE_ID` |
| `VIBA 4,000 Credit Pack` | One-time | USD $200 | 4,000 | `STRIPE_BILLING_CREDITS_4000_PRICE_ID` |
| `VIBA 5,000 Credit Pack` | One-time | USD $250 | 5,000 | `STRIPE_BILLING_CREDITS_5000_PRICE_ID` |
| `VIBA 6,000 Credit Pack` | One-time | USD $300 | 6,000 | `STRIPE_BILLING_CREDITS_6000_PRICE_ID` |

### 3.1 Top-up metadata

For each top-up product/price, set metadata:

```txt
system=viba_billing
type=credit_pack
credits=<credit_amount>
packKey=credits_<credit_amount>
```

Examples:

```txt
# 1,000 pack
system=viba_billing
type=credit_pack
credits=1000
packKey=credits_1000

# 6,000 pack
system=viba_billing
type=credit_pack
credits=6000
packKey=credits_6000
```

After creating each one-time price, copy its `price_...` ID into Railway:

```env
STRIPE_BILLING_CREDITS_1000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_2000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_3000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_4000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_5000_PRICE_ID=price_...
STRIPE_BILLING_CREDITS_6000_PRICE_ID=price_...
```

## 4. Configure Stripe webhook

Create one webhook endpoint:

```txt
https://viba.guru/api/stripe/webhook
```

Enable these events:

```txt
checkout.session.completed
invoice.payment_succeeded
invoice.payment_failed
customer.subscription.updated
customer.subscription.deleted
```

Copy the webhook signing secret into Railway:

```env
STRIPE_WEBHOOK_SECRET=whsec_...
```

## 5. Stripe Billing Portal

Enable the Stripe Billing Portal so users can manage/cancel subscriptions.

Recommended portal settings:

1. Allow subscription cancellation.
2. Allow payment method updates.
3. Allow invoice history.
4. If Stripe supports it in the account, allow plan switching between:
   - `VIBA Member Monthly`
   - `VIBA Pro Monthly`

If plan switching is not configured, `/billing/upgrade/pro` can still open the portal, but the user may not see a Pro upgrade option.

## 6. Railway verification after Stripe setup

After setting all Stripe variables in Railway and redeploying:

1. Visit `/pricing`.
2. Confirm both plans display:
   - Member: $50/month, 1,500 credits
   - Pro: $150/month, 6,000 credits
3. Start Member checkout and confirm Stripe shows `VIBA Member Monthly`.
4. Start Pro checkout and confirm Stripe shows `VIBA Pro Monthly`.
5. Visit `/billing` and confirm top-up packs show $50-$300.
6. Buy a test top-up in Stripe test mode or controlled live-mode test.
7. Confirm webhook grants the correct number of credits.
8. Confirm paid subscription renewal resets credits to the plan allowance:
   - Member: 1,500
   - Pro: 6,000

## 7. Failure checks

If checkout fails:

- Confirm `STRIPE_SECRET_KEY` is set.
- Confirm the correct `price_...` env var exists in Railway.
- Confirm live-mode keys are not mixed with test-mode price IDs.
- Confirm `STRIPE_PRICE_ID` is set to the Member price for legacy compatibility.

If credits are not granted:

- Confirm `STRIPE_WEBHOOK_SECRET` is correct.
- Confirm webhook endpoint is `https://viba.guru/api/stripe/webhook`.
- Confirm webhook events include `checkout.session.completed` and `invoice.payment_succeeded`.
- Confirm top-up price metadata includes `credits` and `packKey`.
