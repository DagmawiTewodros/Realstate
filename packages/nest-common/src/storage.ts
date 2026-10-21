import { Inject, Injectable } from "@nestjs/common";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { APP_CONFIG } from "./tokens";
import type { BaseConfig } from "./config";
import { AppError } from "./errors";

const KEY_PATTERN = /^[a-z0-9][a-z0-9/_-]*\.[a-z0-9]{2,5}$/;

/**
 * File storage: local disk (development and single-server installs) or S3-compatible storage (MinIO, AWS).
 * Files never become public by URL; the API streams them after checking access.
 */
@Injectable()
export class StorageService {
  private readonly s3: S3Client | null;
  private readonly root: string;

  constructor(@Inject(APP_CONFIG) private readonly config: BaseConfig) {
    this.root = resolve(config.STORAGE_DIR);
    this.s3 =
      config.STORAGE_DRIVER === "s3"
        ? new S3Client({
            region: config.S3_REGION,
            endpoint: config.S3_ENDPOINT || undefined,
            forcePathStyle: Boolean(config.S3_ENDPOINT),
            credentials: { accessKeyId: config.S3_ACCESS_KEY!, secretAccessKey: config.S3_SECRET_KEY! },
          })
        : null;
  }

  newKey(prefix: string, extension: string): string {
    return `${prefix.replace(/[^a-z0-9/_-]/g, "")}/${randomUUID()}.${extension}`;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    this.check(key);
    if (this.s3) {
      await this.s3.send(new PutObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key, Body: body, ContentType: contentType }));
      return;
    }
    const path = this.localPath(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Buffer> {
    this.check(key);
    if (this.s3) {
      const out = await this.s3.send(new GetObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key }));
      if (!out.Body) throw new AppError(404, "FILE_NOT_FOUND");
      return Buffer.from(await out.Body.transformToByteArray());
    }
    try {
      return await readFile(this.localPath(key));
    } catch {
      throw new AppError(404, "FILE_NOT_FOUND");
    }
  }

  async delete(key: string): Promise<void> {
    this.check(key);
    if (this.s3) {
      await this.s3.send(new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET!, Key: key }));
      return;
    }
    await rm(this.localPath(key), { force: true });
  }

  private check(key: string): void {
    if (!KEY_PATTERN.test(key) || key.includes("..")) throw new AppError(400, "BAD_FILE_KEY");
  }

  private localPath(key: string): string {
    const path = resolve(this.root, key);
    if (!path.startsWith(this.root)) throw new AppError(400, "BAD_FILE_KEY");
    return path;
  }
}
