import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "@/server/env";

/**
 * Stockage des fichiers (justificatifs, factures archivées).
 *
 * Deux pilotes : disque local (volume du serveur) ou stockage objet compatible
 * S3. Dans les deux cas le contenu est chiffré par l'application (AES-256-GCM)
 * avant d'être écrit : ni l'hébergeur du stockage ni une sauvegarde du volume
 * ne donnent accès aux pièces en clair. Les fichiers ne sont jamais servis
 * directement : toute lecture passe par l'API, après contrôle des droits.
 */

export interface ObjectStorage {
  put(key: string, data: Buffer): Promise<void>;
  /** Retourne `null` si l'objet n'existe pas. */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

const KEY_PATTERN = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

function assertSafeKey(key: string) {
  if (!KEY_PATTERN.test(key) || key.length > 512) throw new Error("Clé de stockage invalide");
}

export class LocalStorage implements ObjectStorage {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(path.resolve(this.root), ...key.split("/"));
  }

  async put(key: string, data: Buffer): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, data, { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolve(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.resolve(key), { force: true });
  }
}

export type S3Options = { endpoint?: string; region?: string; bucket: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean };

export class S3Storage implements ObjectStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(options: S3Options) {
    this.bucket = options.bucket;
    this.client = new S3Client({
      endpoint: options.endpoint || undefined,
      region: options.region || "us-east-1",
      forcePathStyle: options.forcePathStyle,
      // Les sommes de contrôle additionnelles d'AWS ne sont pas comprises par tous les stockages compatibles S3.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: data, ContentType: "application/octet-stream" }));
  }

  async get(key: string): Promise<Buffer | null> {
    assertSafeKey(key);
    try {
      const response = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      if (!response.Body) return null;
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      const name = (error as { name?: string }).name;
      if (name === "NoSuchKey" || name === "NotFound") return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

let cached: ObjectStorage | undefined;

export function storage(): ObjectStorage {
  if (cached) return cached;
  const config = env();
  cached =
    config.STORAGE_DRIVER === "s3"
      ? new S3Storage({
          endpoint: config.S3_ENDPOINT,
          region: config.S3_REGION,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorage(config.STORAGE_LOCAL_DIR);
  return cached;
}

/** Réservé aux tests. */
export function setStorageForTests(instance: ObjectStorage | undefined) {
  cached = instance;
}

// --- Chiffrement du contenu -------------------------------------------------------

const MAGIC = Buffer.from("CPD1");

/** Clé dédiée aux fichiers, dérivée de la clé de l'application (distincte de celle des secrets en base). */
function fileKey(): Buffer {
  return Buffer.from(hkdfSync("sha256", Buffer.from(env().APP_ENCRYPTION_KEY, "base64"), Buffer.alloc(0), "comptapro:documents:v1", 32));
}

/** Format : « CPD1 » + IV (12 octets) + sceau (16 octets) + données chiffrées. La clé de l'objet est authentifiée. */
export function encryptFile(key: string, plaintext: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", fileKey(), iv);
  cipher.setAAD(Buffer.from(key));
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), encrypted]);
}

export function decryptFile(key: string, payload: Buffer): Buffer {
  if (payload.length < 32 || !payload.subarray(0, 4).equals(MAGIC)) throw new Error("Fichier chiffré illisible");
  const decipher = createDecipheriv("aes-256-gcm", fileKey(), payload.subarray(4, 16));
  decipher.setAAD(Buffer.from(key));
  decipher.setAuthTag(payload.subarray(16, 32));
  return Buffer.concat([decipher.update(payload.subarray(32)), decipher.final()]);
}

export async function putEncrypted(key: string, plaintext: Buffer): Promise<void> {
  await storage().put(key, encryptFile(key, plaintext));
}

export async function getDecrypted(key: string): Promise<Buffer | null> {
  const payload = await storage().get(key);
  return payload ? decryptFile(key, payload) : null;
}
