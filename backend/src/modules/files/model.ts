import type { Types } from 'mongoose';

/**
 * Files live in GridFS (bucket "files" -> collections files.files / files.chunks),
 * so there is no Mongoose model. This is the shape of `metadata` on each file.
 * File contents are encrypted client-side; `encryptedKey` is the per-file key
 * wrapped for the scope (never usable by the server).
 */
export const FILE_SCOPES = ['workspace', 'room', 'couple', 'user'] as const;
export type FileScope = (typeof FILE_SCOPES)[number];

export interface FileMetadata {
  ownerScope: FileScope;
  scopeId: Types.ObjectId;
  uploaderId: Types.ObjectId;
  /** Declared MIME type of the plaintext (validated against an allow-list). */
  mime: string;
  encryptedKey: string;
}

export const GRIDFS_BUCKET = 'files';
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
