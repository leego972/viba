export type AttributionModel = "first_touch" | "last_touch";
export type CommissionType = "fixed" | "percentage";
export type CommissionStatus = "pending" | "approved" | "payable" | "paid" | "reversed" | "held";

export interface Campaign {
  id: string;
  name: string;
  attributionModel: AttributionModel;
  cookieDays: number;
  commissionType: CommissionType;
  commissionValue: bigint;
  recurringMonths: number;
  minimumOrderAmount: bigint;
  active: boolean;
}

export interface Affiliate {
  id: string;
  code: string;
  status: "active" | "paused" | "blocked";
  payoutMethod?: "manual" | "stripe_connect" | "credits";
}

export interface ReferralClick {
  id: string;
  affiliateId: string;
  campaignId: string;
  visitorId: string;
  occurredAt: Date;
  metadata?: Record<string, string>;
}

export interface ConversionInput {
  idempotencyKey: string;
  conversionId: string;
  campaignId: string;
  visitorId: string;
  orderAmount: bigint;
  occurredAt: Date;
  recurringSequence?: number;
}

export interface CommissionEntry {
  id: string;
  affiliateId: string;
  campaignId: string;
  conversionId: string;
  amount: bigint;
  status: CommissionStatus;
  createdAt: Date;
  updatedAt: Date;
  reversalOf?: string;
  reason?: string;
}

export interface PayoutBatch {
  id: string;
  affiliateId: string;
  commissionIds: string[];
  totalAmount: bigint;
  status: "created" | "exported" | "paid" | "failed";
  createdAt: Date;
}

export class AffiliateEngineError extends Error {}
export class DuplicateConversionError extends AffiliateEngineError {}
export class InvalidTransitionError extends AffiliateEngineError {}

export interface AffiliateStore {
  getAffiliate(id: string): Promise<Affiliate | undefined>;
  getCampaign(id: string): Promise<Campaign | undefined>;
  listClicks(visitorId: string, campaignId: string): Promise<ReferralClick[]>;
  saveClick(click: ReferralClick): Promise<void>;
  getCommissionByIdempotencyKey(key: string): Promise<CommissionEntry | undefined>;
  saveCommission(entry: CommissionEntry, idempotencyKey: string): Promise<void>;
  getCommission(id: string): Promise<CommissionEntry | undefined>;
  updateCommission(entry: CommissionEntry): Promise<void>;
  listAffiliateCommissions(affiliateId: string): Promise<CommissionEntry[]>;
  savePayoutBatch(batch: PayoutBatch): Promise<void>;
}

export interface IdGenerator { next(prefix: string): string; }

export class SequentialIdGenerator implements IdGenerator {
  private value = 0;
  next(prefix: string): string {
    this.value += 1;
    return `${prefix}_${this.value}`;
  }
}

export class AffiliateReferralEngine {
  constructor(
    private readonly store: AffiliateStore,
    private readonly ids: IdGenerator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async trackClick(input: Omit<ReferralClick, "id">): Promise<ReferralClick> {
    const affiliate = await this.store.getAffiliate(input.affiliateId);
    if (!affiliate || affiliate.status !== "active") throw new AffiliateEngineError("Affiliate is not active");
    const campaign = await this.store.getCampaign(input.campaignId);
    if (!campaign || !campaign.active) throw new AffiliateEngineError("Campaign is not active");
    const click: ReferralClick = { ...input, id: this.ids.next("click") };
    await this.store.saveClick(click);
    return click;
  }

  async recordConversion(input: ConversionInput): Promise<CommissionEntry | null> {
    const replay = await this.store.getCommissionByIdempotencyKey(input.idempotencyKey);
    if (replay) return replay;
    const campaign = await this.store.getCampaign(input.campaignId);
    if (!campaign || !campaign.active) throw new AffiliateEngineError("Campaign is not active");
    if (input.orderAmount < campaign.minimumOrderAmount) return null;
    if ((input.recurringSequence ?? 1) > Math.max(1, campaign.recurringMonths)) return null;

    const clicks = await this.store.listClicks(input.visitorId, input.campaignId);
    const cutoff = input.occurredAt.getTime() - campaign.cookieDays * 86_400_000;
    const eligible = clicks.filter((click) => click.occurredAt.getTime() >= cutoff && click.occurredAt <= input.occurredAt);
    if (eligible.length === 0) return null;
    eligible.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
    const click = campaign.attributionModel === "first_touch" ? eligible[0] : eligible[eligible.length - 1];
    if (!click) return null;

    const amount = campaign.commissionType === "fixed"
      ? campaign.commissionValue
      : (input.orderAmount * campaign.commissionValue) / 10_000n;
    const createdAt = this.now();
    const entry: CommissionEntry = {
      id: this.ids.next("commission"), affiliateId: click.affiliateId, campaignId: campaign.id,
      conversionId: input.conversionId, amount, status: "pending", createdAt, updatedAt: createdAt,
    };
    await this.store.saveCommission(entry, input.idempotencyKey);
    return entry;
  }

  async transitionCommission(id: string, next: CommissionStatus, reason?: string): Promise<CommissionEntry> {
    const entry = await this.store.getCommission(id);
    if (!entry) throw new AffiliateEngineError("Commission not found");
    const allowed: Record<CommissionStatus, CommissionStatus[]> = {
      pending: ["approved", "held", "reversed"], approved: ["payable", "held", "reversed"],
      payable: ["paid", "held", "reversed"], held: ["approved", "reversed"], paid: ["reversed"], reversed: [],
    };
    if (!allowed[entry.status].includes(next)) throw new InvalidTransitionError(`${entry.status} cannot transition to ${next}`);
    const updated: CommissionEntry = { ...entry, status: next, updatedAt: this.now(), ...(reason ? { reason } : {}) };
    await this.store.updateCommission(updated);
    return updated;
  }

  async reverseCommission(id: string, reason: string): Promise<CommissionEntry> {
    return this.transitionCommission(id, "reversed", reason);
  }

  async createPayoutBatch(affiliateId: string): Promise<PayoutBatch> {
    const commissions = (await this.store.listAffiliateCommissions(affiliateId)).filter((entry) => entry.status === "payable");
    if (commissions.length === 0) throw new AffiliateEngineError("No payable commissions");
    const batch: PayoutBatch = {
      id: this.ids.next("payout"), affiliateId, commissionIds: commissions.map((entry) => entry.id),
      totalAmount: commissions.reduce((sum, entry) => sum + entry.amount, 0n), status: "created", createdAt: this.now(),
    };
    await this.store.savePayoutBatch(batch);
    return batch;
  }
}

export class InMemoryAffiliateStore implements AffiliateStore {
  affiliates = new Map<string, Affiliate>(); campaigns = new Map<string, Campaign>(); clicks: ReferralClick[] = [];
  commissions = new Map<string, CommissionEntry>(); idempotency = new Map<string, string>(); payoutBatches: PayoutBatch[] = [];
  async getAffiliate(id: string) { return this.affiliates.get(id); }
  async getCampaign(id: string) { return this.campaigns.get(id); }
  async listClicks(visitorId: string, campaignId: string) { return this.clicks.filter((c) => c.visitorId === visitorId && c.campaignId === campaignId); }
  async saveClick(click: ReferralClick) { this.clicks.push(click); }
  async getCommissionByIdempotencyKey(key: string) { const id = this.idempotency.get(key); return id ? this.commissions.get(id) : undefined; }
  async saveCommission(entry: CommissionEntry, key: string) { if (this.idempotency.has(key)) throw new DuplicateConversionError("Duplicate conversion"); this.commissions.set(entry.id, entry); this.idempotency.set(key, entry.id); }
  async getCommission(id: string) { return this.commissions.get(id); }
  async updateCommission(entry: CommissionEntry) { this.commissions.set(entry.id, entry); }
  async listAffiliateCommissions(affiliateId: string) { return [...this.commissions.values()].filter((entry) => entry.affiliateId === affiliateId); }
  async savePayoutBatch(batch: PayoutBatch) { this.payoutBatches.push(batch); }
}
