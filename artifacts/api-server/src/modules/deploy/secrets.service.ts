import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const SALT = "viba-deploy-secrets-v1";

const SECRET_PATTERNS = [
  /password=[^&\s]+/gi,
  /secret=[^&\s]+/gi,
  /token=[^&\s]+/gi,
  /key=[^&\s]+/gi,
  /DATABASE_URL=\S+/gi,
  /REDIS_URL=\S+/gi,
  /postgresql:\/\/[^@]+@[^/]+/gi,
  /redis:\/\/:[^@]+@[^/]+/gi,
];

function getDerivedKey(): Buffer {
  const masterKey = process.env.SECRET_ENCRYPTION_KEY || process.env.SESSION_SECRET || "viba-deploy-default-key-CHANGE-IN-PROD";
  return crypto.scryptSync(masterKey, SALT, 32);
}

export function encryptSecret(plaintext: string): string {
  const key = getDerivedKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

export function decryptSecret(ciphertext: string): string {
  const key = getDerivedKey();
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

export function maskSecrets(text: string): string {
  let masked = text;
  for (const pattern of SECRET_PATTERNS) {
    masked = masked.replace(pattern, (match) => {
      const eqIdx = match.indexOf("=");
      if (eqIdx !== -1) {
        return match.slice(0, eqIdx + 1) + "****";
      }
      return "****";
    });
  }
  return masked;
}

export function maskValue(value: string): string {
  if (value.length <= 8) return "****";
  return value.slice(0, 4) + "****" + value.slice(-4);
}

export function generateSecurePassword(length = 24): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

export function generateVerificationToken(): string {
  return crypto.randomBytes(20).toString("hex");
}
