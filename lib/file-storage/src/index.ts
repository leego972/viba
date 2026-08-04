export type StorageClass = "media" | "asset";

export interface ObjectStorageConfig {
  buckets: Record<StorageClass, string>;
  maxObjectBytes: number;
  defaultClass?: StorageClass;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array | string;
  contentType?: string;
  storageClass?: StorageClass;
  public?: boolean;
}

export interface StoredObject {
  bucket: string;
  key: string;
  storageClass: StorageClass;
  size: number;
  contentType: string;
  public: boolean;
}

export interface HeadObjectResult {
  exists: boolean;
  size?: number;
  contentType?: string;
}

export interface ObjectStorageAdapter {
  put(bucket: string, input: Omit<PutObjectInput, "storageClass">): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
  head(bucket: string, key: string): Promise<HeadObjectResult>;
  signedGetUrl(bucket: string, key: string, expiresInSeconds: number): Promise<string>;
}

export class StorageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StorageValidationError";
  }
}

export class FileStorageService {
  constructor(
    private readonly adapter: ObjectStorageAdapter,
    private readonly config: ObjectStorageConfig,
  ) {
    if (!Number.isSafeInteger(config.maxObjectBytes) || config.maxObjectBytes <= 0) {
      throw new StorageValidationError("maxObjectBytes must be a positive safe integer");
    }
    if (!config.buckets.media || !config.buckets.asset) {
      throw new StorageValidationError("media and asset buckets are required");
    }
  }

  resolveBucket(storageClass: StorageClass): string {
    const bucket = this.config.buckets[storageClass];
    if (!bucket.trim()) throw new StorageValidationError(`missing bucket for ${storageClass}`);
    return bucket;
  }

  normalizeKey(key: string): string {
    const normalized = key.replace(/^\/+/, "").replace(/\\/g, "/");
    if (!normalized || normalized.includes("..") || normalized.includes("\0")) {
      throw new StorageValidationError("invalid object key");
    }
    return normalized;
  }

  async put(input: PutObjectInput): Promise<StoredObject> {
    const storageClass = input.storageClass ?? this.config.defaultClass ?? "media";
    const bucket = this.resolveBucket(storageClass);
    const key = this.normalizeKey(input.key);
    const body = typeof input.body === "string" ? new TextEncoder().encode(input.body) : input.body;
    if (body.byteLength > this.config.maxObjectBytes) {
      throw new StorageValidationError(`object exceeds maximum size: ${body.byteLength}`);
    }
    const contentType = input.contentType ?? "application/octet-stream";
    const isPublic = input.public === true;
    await this.adapter.put(bucket, { key, body, contentType, public: isPublic });
    return { bucket, key, storageClass, size: body.byteLength, contentType, public: isPublic };
  }

  async delete(key: string, storageClass: StorageClass = this.config.defaultClass ?? "media"): Promise<void> {
    await this.adapter.delete(this.resolveBucket(storageClass), this.normalizeKey(key));
  }

  async head(key: string, storageClass: StorageClass = this.config.defaultClass ?? "media"): Promise<HeadObjectResult> {
    return this.adapter.head(this.resolveBucket(storageClass), this.normalizeKey(key));
  }

  async signedGetUrl(
    key: string,
    options: { storageClass?: StorageClass; expiresInSeconds?: number } = {},
  ): Promise<string> {
    const expires = options.expiresInSeconds ?? 900;
    if (!Number.isInteger(expires) || expires < 60 || expires > 86400) {
      throw new StorageValidationError("expiresInSeconds must be between 60 and 86400");
    }
    const storageClass = options.storageClass ?? this.config.defaultClass ?? "media";
    return this.adapter.signedGetUrl(this.resolveBucket(storageClass), this.normalizeKey(key), expires);
  }
}
