/**
 * Reusable Zod primitives composed by every other schema in this package.
 *
 * Defining these once means "what is a valid password / id / page size" has a
 * single answer enforced identically on the mobile app, the web app, and the API.
 */

import { z } from 'zod';
import {
  GENRES,
  REGIONS,
  INSTRUMENTS,
  CONTENT_LANGUAGES,
  UI_LANGUAGES,
} from '@sma/constants';

// ── Identifiers ───────────────────────────────────────────────────────────────

/** PostgreSQL UUID (users, subscriptions, …). */
export const uuidSchema = z.string().uuid();

/** MongoDB ObjectId serialised as 24 hex chars (recordings, artists). */
export const objectIdSchema = z
  .string()
  .regex(/^[a-f0-9]{24}$/i, 'Must be a 24-character hex ObjectId');

// ── Credentials & identity ────────────────────────────────────────────────────

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('Enter a valid email address')
  .max(254);

/**
 * Password policy. Length is the dominant factor in real-world strength, so we
 * require a healthy minimum and cap the length (bcrypt only hashes the first 72
 * bytes — ARCHITECTURE.md §11 — so an unbounded input is a footgun). Composition
 * rules stay light to avoid pushing users toward predictable patterns.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(72, 'Use at most 72 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/[0-9]/, 'Include at least one number');

export const displayNameSchema = z
  .string()
  .trim()
  .min(2, 'Name is too short')
  .max(60, 'Name is too long');

// ── Enums (built from the canonical constant lists — never drift) ─────────────

export const genreSchema = z.enum(GENRES);
export const regionSchema = z.enum(REGIONS);
export const instrumentSchema = z.enum(INSTRUMENTS);
export const contentLanguageSchema = z.enum(CONTENT_LANGUAGES);
export const uiLanguageSchema = z.enum(UI_LANGUAGES);

// ── Pagination ────────────────────────────────────────────────────────────────

/** Hard ceiling on page size to protect the API from expensive scans (§14). */
export const MAX_PAGE_SIZE = 100;

/**
 * List query params arrive as strings (`?page=2&limit=20`), so we coerce. Defaults
 * make the params optional for callers while giving handlers concrete numbers.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(MAX_PAGE_SIZE).default(20),
});

export type PaginationQueryInput = z.input<typeof paginationQuerySchema>;
export type PaginationQuery = z.output<typeof paginationQuerySchema>;
