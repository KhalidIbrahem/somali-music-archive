/**
 * Library types — scanned books of Somali music sheets and songbooks.
 *
 * The library holds documents rather than audio: PDF scans (or page images) of
 * notation books, uploaded by contributors through the same presigned-R2 flow
 * as recordings (audio/documents never pass through Node — CONVENTIONS.md).
 */

import type { IsoDateTimeString } from './common';

export type BookContentType = 'application/pdf' | 'image/jpeg' | 'image/png';

/** A book on the library shelf, as returned by the API. */
export interface LibraryBook {
  readonly id: string;
  readonly title: string;
  readonly author: string | null;
  readonly description: string | null;
  readonly contentType: BookContentType;
  /** Opaque R2 object key (UUID-based — never the original filename). */
  readonly fileKey: string;
  readonly uploadedBy: string;
  readonly createdAt: IsoDateTimeString;
}

/** Short-lived signed URL for reading a book file. */
export interface SignedBookUrl {
  readonly url: string;
  readonly expiresAt: IsoDateTimeString;
}
