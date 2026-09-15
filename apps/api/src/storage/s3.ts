import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';
import type { S3Env } from '../config';

export interface StoredObject {
  body: Readable;
  contentType: string;
}

/**
 * S3-compatible object storage (MinIO in local/dev, any S3 provider in prod).
 * Keys are scoped per session: attachments/{userId}/{uuid}.{ext}
 */
export class S3Storage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(env: S3Env) {
    if (!env.bucket) throw new Error('S3 bucket is not configured');
    this.bucket = env.bucket;
    this.client = new S3Client({
      endpoint: env.endpoint,
      region: env.region ?? 'us-east-1',
      forcePathStyle: Boolean(env.endpoint),
      credentials: {
        accessKeyId: env.accessKeyId ?? 'local',
        secretAccessKey: env.secretAccessKey ?? 'local',
      },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch {
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer | string, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType }),
    );
  }

  async get(key: string): Promise<StoredObject | undefined> {
    try {
      const r = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return { body: r.Body as Readable, contentType: r.ContentType ?? 'application/octet-stream' };
    } catch (err) {
      const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e.name === 'NoSuchKey' || e.$metadata?.httpStatusCode === 404) return undefined;
      throw err;
    }
  }

  /** Presigned GET URL (used when the S3 endpoint is publicly reachable). */
  async presignGet(key: string, ttlSeconds = 600): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }
}
