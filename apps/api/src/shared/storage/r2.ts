/**
 * Cloudflare R2 storage (S3-compatible) — presigned URL generation.
 *
 * CLAUDE.md hard rules enforced here:
 *   • audio NEVER flows through Node — clients PUT directly to R2 with a short-lived
 *     presigned upload URL (§8),
 *   • objects are keyed by a random UUID, NEVER the original filename (§11 Threat 5),
 *   • download URLs are signed and expire in 1 hour (§11 Threat 1).
 *
 * The bucket is private; the only way in or out is through these signed URLs.
 */

import { randomUUID } from 'node:crypto';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '@/config/env';

/** Presigned upload URLs live for 15 minutes (ARCHITECTURE.md §8). */
const UPLOAD_URL_TTL_SECONDS = 15 * 60;
/** Presigned download URLs live for 1 hour (ARCHITECTURE.md §11 Threat 1). */
const DOWNLOAD_URL_TTL_SECONDS = 60 * 60;

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'audio/wav': 'wav',
  'audio/webm': 'webm',
  'audio/flac': 'flac',
};

const client = new S3Client({
  region: 'auto',
  endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

export interface PresignedUpload {
  /** The URL the client PUTs the raw audio bytes to. */
  uploadUrl: string;
  /** The opaque object key stored on the recording — never the original filename. */
  fileKey: string;
  /** When the upload URL stops working (ISO-8601). */
  expiresAt: string;
}

/** Build a UUID object key with the correct extension for the content type. */
function buildFileKey(contentType: string): string {
  const ext = CONTENT_TYPE_EXTENSION[contentType] ?? 'bin';
  // Shard by first two hex chars to avoid a single giant flat prefix at scale.
  const id = randomUUID();
  return `recordings/${id.slice(0, 2)}/${id}.${ext}`;
}

export async function generateUploadUrl(contentType: string): Promise<PresignedUpload> {
  const fileKey = buildFileKey(contentType);
  const command = new PutObjectCommand({
    Bucket: env.R2_BUCKET_NAME,
    Key: fileKey,
    ContentType: contentType,
  });
  const uploadUrl = await getSignedUrl(client, command, { expiresIn: UPLOAD_URL_TTL_SECONDS });
  const expiresAt = new Date(Date.now() + UPLOAD_URL_TTL_SECONDS * 1000).toISOString();
  return { uploadUrl, fileKey, expiresAt };
}

export async function generateDownloadUrl(
  fileKey: string,
): Promise<{ url: string; expiresAt: string }> {
  const command = new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: fileKey });
  const url = await getSignedUrl(client, command, { expiresIn: DOWNLOAD_URL_TTL_SECONDS });
  const expiresAt = new Date(Date.now() + DOWNLOAD_URL_TTL_SECONDS * 1000).toISOString();
  return { url, expiresAt };
}

/** Verify an uploaded object actually exists in R2 (called on upload-complete, §8). */
export async function objectExists(fileKey: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: fileKey }));
    return true;
  } catch {
    return false;
  }
}
