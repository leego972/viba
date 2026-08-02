export type CreditEntryType =
  | "grant"
  | "purchase"
  | "debit"
  | "refund"
  | "adjustment"
  | "reservation"
  | "reservation_capture"
  | "reservation_release"
  | "expiry";

export interface CreditEntry {
  id: string;
  accountId: string;
  type: CreditEntryType;
  amount: bigint;
  availableDelta: bigint;
  reservedDelta: bigint;
  reference?: string;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, string>>;
  createdAt: Date;
}

export interface CreditBalance {
  available: bigint;
  reserved: bigint;
  total: bigint;
}

export interface Reservation {
  id: string;
  accountId: string;
  amount: bigint;
  captured: bigint;
  released: bigint;
  status: "open" | "captured" | "released";
  createdAt: Date;
}

export interface EntryInput {
  accountId: string;
  amount: bigint;
  reference?: string;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, string>>;
}

export class CreditLedgerError extends Error {}
export class InsufficientCreditsError extends CreditLedgerError {}
export class DuplicateIdempotencyKeyError extends CreditLedgerError {}
export class ReservationStateError extends CreditLedgerError {}

export interface CreditLedgerStore {
  append(entry: CreditEntry): Promise<void>;
  list(accountId: string): Promise<readonly CreditEntry[]>;
  findByIdempotencyKey(key: string): Promise<CreditEntry | undefined>;
  saveReservation(reservation: Reservation): Promise<void>;
  getReservation(id: string): Promise<Reservation | undefined>;
}

export interface IdGenerator {
  next(): string;
}

export class CreditLedger {
  constructor(
    private readonly store: CreditLedgerStore,
    private readonly ids: IdGenerator,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async balance(accountId: string): Promise<CreditBalance> {
    const entries = await this.store.list(accountId);
    const available = entries.reduce((sum, entry) => sum + entry.availableDelta, 0n);
    const reserved = entries.reduce((sum, entry) => sum + entry.reservedDelta, 0n);
    return { available, reserved, total: available + reserved };
  }

  async grant(input: EntryInput, type: "grant" | "purchase" | "adjustment" = "grant"): Promise<CreditEntry> {
    this.assertPositive(input.amount);
    return this.append(input, type, input.amount, 0n);
  }

  async debit(input: EntryInput): Promise<CreditEntry> {
    this.assertPositive(input.amount);
    const balance = await this.balance(input.accountId);
    if (balance.available < input.amount) {
      throw new InsufficientCreditsError("Insufficient available credits");
    }
    return this.append(input, "debit", -input.amount, 0n);
  }

  async refund(input: EntryInput): Promise<CreditEntry> {
    this.assertPositive(input.amount);
    return this.append(input, "refund", input.amount, 0n);
  }

  async reserve(input: EntryInput): Promise<Reservation> {
    this.assertPositive(input.amount);
    const balance = await this.balance(input.accountId);
    if (balance.available < input.amount) {
      throw new InsufficientCreditsError("Insufficient available credits");
    }
    await this.append(input, "reservation", -input.amount, input.amount);
    const reservation: Reservation = {
      id: this.ids.next(),
      accountId: input.accountId,
      amount: input.amount,
      captured: 0n,
      released: 0n,
      status: "open",
      createdAt: this.now(),
    };
    await this.store.saveReservation(reservation);
    return reservation;
  }

  async capture(reservationId: string, amount?: bigint): Promise<Reservation> {
    const reservation = await this.requireOpenReservation(reservationId);
    const remaining = reservation.amount - reservation.captured - reservation.released;
    const captureAmount = amount ?? remaining;
    this.assertPositive(captureAmount);
    if (captureAmount > remaining) throw new ReservationStateError("Capture exceeds remaining reservation");

    await this.append(
      { accountId: reservation.accountId, amount: captureAmount, reference: reservation.id },
      "reservation_capture",
      0n,
      -captureAmount,
    );
    const updated: Reservation = {
      ...reservation,
      captured: reservation.captured + captureAmount,
      status: captureAmount === remaining ? "captured" : "open",
    };
    await this.store.saveReservation(updated);
    return updated;
  }

  async release(reservationId: string, amount?: bigint): Promise<Reservation> {
    const reservation = await this.requireOpenReservation(reservationId);
    const remaining = reservation.amount - reservation.captured - reservation.released;
    const releaseAmount = amount ?? remaining;
    this.assertPositive(releaseAmount);
    if (releaseAmount > remaining) throw new ReservationStateError("Release exceeds remaining reservation");

    await this.append(
      { accountId: reservation.accountId, amount: releaseAmount, reference: reservation.id },
      "reservation_release",
      releaseAmount,
      -releaseAmount,
    );
    const updated: Reservation = {
      ...reservation,
      released: reservation.released + releaseAmount,
      status: releaseAmount === remaining ? "released" : "open",
    };
    await this.store.saveReservation(updated);
    return updated;
  }

  private async append(
    input: EntryInput,
    type: CreditEntryType,
    availableDelta: bigint,
    reservedDelta: bigint,
  ): Promise<CreditEntry> {
    if (input.idempotencyKey) {
      const existing = await this.store.findByIdempotencyKey(input.idempotencyKey);
      if (existing) return existing;
    }
    const entry: CreditEntry = {
      id: this.ids.next(),
      accountId: input.accountId,
      type,
      amount: input.amount,
      availableDelta,
      reservedDelta,
      createdAt: this.now(),
      ...(input.reference === undefined ? {} : { reference: input.reference }),
      ...(input.idempotencyKey === undefined ? {} : { idempotencyKey: input.idempotencyKey }),
      ...(input.metadata === undefined ? {} : { metadata: input.metadata }),
    };
    await this.store.append(entry);
    return entry;
  }

  private async requireOpenReservation(id: string): Promise<Reservation> {
    const reservation = await this.store.getReservation(id);
    if (!reservation) throw new ReservationStateError("Reservation not found");
    if (reservation.status !== "open") throw new ReservationStateError("Reservation is not open");
    return reservation;
  }

  private assertPositive(amount: bigint): void {
    if (amount <= 0n) throw new CreditLedgerError("Amount must be greater than zero");
  }
}

export class InMemoryCreditLedgerStore implements CreditLedgerStore {
  private readonly entries: CreditEntry[] = [];
  private readonly reservations = new Map<string, Reservation>();

  async append(entry: CreditEntry): Promise<void> {
    if (entry.idempotencyKey && (await this.findByIdempotencyKey(entry.idempotencyKey))) {
      throw new DuplicateIdempotencyKeyError("Duplicate idempotency key");
    }
    this.entries.push(entry);
  }

  async list(accountId: string): Promise<readonly CreditEntry[]> {
    return this.entries.filter((entry) => entry.accountId === accountId);
  }

  async findByIdempotencyKey(key: string): Promise<CreditEntry | undefined> {
    return this.entries.find((entry) => entry.idempotencyKey === key);
  }

  async saveReservation(reservation: Reservation): Promise<void> {
    this.reservations.set(reservation.id, reservation);
  }

  async getReservation(id: string): Promise<Reservation | undefined> {
    return this.reservations.get(id);
  }
}

export class SequentialIdGenerator implements IdGenerator {
  private value = 0;
  constructor(private readonly prefix = "credit") {}
  next(): string {
    this.value += 1;
    return `${this.prefix}_${this.value}`;
  }
}
