import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import mongoose, { Types } from 'mongoose';
import type { FileMetadata } from '../modules/files/model.js';

/**
 * File storage abstraction. GridFS today; an R2/S3 implementation can satisfy
 * the same interface later without touching routes or services.
 */
export interface StoredFile {
  id: string;
  filename: string;
  length: number;
  uploadDate: Date;
  metadata: FileMetadata;
}

export interface UploadOptions {
  filename: string;
  metadata: FileMetadata;
  /** Abort and delete the partial file once this many bytes have been written. */
  maxBytes?: number;
}

export class FileTooLargeError extends Error {
  constructor(public readonly maxBytes: number) {
    super(`File exceeds ${maxBytes} bytes`);
    this.name = 'FileTooLargeError';
  }
}

export interface StorageFilter {
  ownerScope?: FileMetadata['ownerScope'];
  scopeId?: string;
  uploaderId?: string;
}

export interface StorageService {
  upload(source: Readable, opts: UploadOptions): Promise<StoredFile>;
  find(id: string): Promise<StoredFile | null>;
  list(filter: StorageFilter, opts?: { limit?: number; before?: Date }): Promise<StoredFile[]>;
  openDownload(id: string): Readable;
  delete(id: string): Promise<void>;
}

type GridFile = mongoose.mongo.GridFSFile & { metadata?: FileMetadata };

const toStored = (f: GridFile): StoredFile => ({
  id: String(f._id),
  filename: f.filename,
  length: f.length,
  uploadDate: f.uploadDate,
  metadata: f.metadata as FileMetadata,
});

export class GridFsStorageService implements StorageService {
  private readonly bucket: mongoose.mongo.GridFSBucket;

  constructor(db: mongoose.mongo.Db, bucketName = 'files') {
    this.bucket = new mongoose.mongo.GridFSBucket(db, { bucketName });
  }

  async upload(source: Readable, opts: UploadOptions): Promise<StoredFile> {
    const id = new Types.ObjectId();
    const upload = this.bucket.openUploadStreamWithId(id, opts.filename, { metadata: opts.metadata });

    let written = 0;
    const max = opts.maxBytes;
    if (max !== undefined) {
      source.on('data', (chunk: Buffer) => {
        written += chunk.length;
        if (written > max) source.destroy(new FileTooLargeError(max));
      });
    }

    try {
      await pipeline(source, upload);
    } catch (err) {
      await upload.abort().catch(() => undefined);
      await this.bucket.delete(id).catch(() => undefined);
      throw err;
    }

    const stored = await this.find(String(id));
    if (!stored) throw new Error('Upload finished but file was not found');
    return stored;
  }

  async find(id: string): Promise<StoredFile | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    const [file] = await this.bucket.find({ _id: new Types.ObjectId(id) }, { limit: 1 }).toArray();
    return file ? toStored(file as GridFile) : null;
  }

  async list(filter: StorageFilter, opts: { limit?: number; before?: Date } = {}): Promise<StoredFile[]> {
    const q: Record<string, unknown> = {};
    if (filter.ownerScope) q['metadata.ownerScope'] = filter.ownerScope;
    if (filter.scopeId) q['metadata.scopeId'] = new Types.ObjectId(filter.scopeId);
    if (filter.uploaderId) q['metadata.uploaderId'] = new Types.ObjectId(filter.uploaderId);
    if (opts.before) q.uploadDate = { $lt: opts.before };
    const files = await this.bucket
      .find(q, { sort: { uploadDate: -1 }, limit: Math.min(opts.limit ?? 50, 200) })
      .toArray();
    return files.map((f) => toStored(f as GridFile));
  }

  openDownload(id: string): Readable {
    return this.bucket.openDownloadStream(new Types.ObjectId(id));
  }

  async delete(id: string): Promise<void> {
    await this.bucket.delete(new Types.ObjectId(id));
  }
}

/** Ensure the metadata index used by `list` exists. */
export async function ensureStorageIndexes(db: mongoose.mongo.Db, bucketName = 'files'): Promise<void> {
  await db
    .collection(`${bucketName}.files`)
    .createIndex({ 'metadata.scopeId': 1, uploadDate: -1 }, { name: 'metadata_scope_uploadDate' });
}

