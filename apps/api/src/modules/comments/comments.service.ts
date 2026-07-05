/**
 * Comments service (SESSION P4-05, ARCHITECTURE.md §16 Phase 4).
 *
 * Signed-in users comment on PUBLISHED recordings; the author's display name is
 * snapshotted at write time. Comments are keyed by the recording's canonical
 * ObjectId, so posting and listing agree whichever id form the client used. A
 * comment can be removed by its author or an admin (soft delete).
 *
 * Injected repositories (ADR-0005) so every branch is unit-testable in-memory.
 */

import type { Paginated, PublicComment, UserRole } from '@sma/types';
import type { CommentsQueryInput, CreateCommentInput } from '@sma/validators';
import { asIso, asUuid } from '@/shared/brand';
import { forbidden, notFound } from '@/shared/errors/AppError';
import {
  recordingRepository,
  type RecordingRepository,
} from '@/modules/recordings/recordings.repository';
import { userRepository, type UserRepository } from '@/modules/auth/user.repository';
import {
  commentRepository,
  type CommentRecord,
  type CommentRepository,
} from './comments.repository';

function toPublicComment(record: CommentRecord): PublicComment {
  return {
    id: asUuid(record.id),
    recordingId: record.recordingId,
    author: { id: asUuid(record.userId), name: record.authorName },
    body: record.body,
    createdAt: asIso(record.createdAt),
  };
}

export interface CommentsServiceDeps {
  repo: CommentRepository;
  recordings: RecordingRepository;
  users: Pick<UserRepository, 'findById'>;
}

export function createCommentsService(deps: CommentsServiceDeps) {
  const { repo, recordings, users } = deps;

  async function createComment(userId: string, input: CreateCommentInput): Promise<PublicComment> {
    const recording = await recordings.findById(input.recordingId);
    if (!recording || recording.status !== 'published') {
      throw notFound('RECORDING_NOT_FOUND', 'Recording not found');
    }
    const user = await users.findById(userId);
    const record = await repo.create({
      recordingId: String(recording._id),
      userId,
      authorName: user?.displayName ?? 'Member',
      body: input.body,
    });
    return toPublicComment(record);
  }

  async function listComments(query: CommentsQueryInput): Promise<Paginated<PublicComment>> {
    const recording = await recordings.findById(query.recordingId);
    if (!recording) {
      return { data: [], total: 0, page: query.page, limit: query.limit, hasMore: false };
    }
    const { items, total } = await repo.listForRecording(
      String(recording._id),
      query.page,
      query.limit,
    );
    return {
      data: items.map(toPublicComment),
      total,
      page: query.page,
      limit: query.limit,
      hasMore: (query.page - 1) * query.limit + query.limit < total,
    };
  }

  /** Delete a comment. The author may remove their own; admins may remove any. */
  async function deleteComment(userId: string, role: UserRole, commentId: string): Promise<void> {
    const comment = await repo.findById(commentId);
    if (!comment) throw notFound('NOT_FOUND', 'Comment not found');
    if (comment.userId !== userId && role !== 'admin') throw forbidden();
    await repo.softDelete(commentId);
  }

  return { createComment, listComments, deleteComment };
}

export type CommentsService = ReturnType<typeof createCommentsService>;

export const commentsService: CommentsService = createCommentsService({
  repo: commentRepository,
  recordings: recordingRepository,
  users: userRepository,
});
