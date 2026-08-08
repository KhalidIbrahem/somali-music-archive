/**
 * The versioned API router (ARCHITECTURE.md §12 — everything under /api/v1).
 *
 * Each feature module owns its own router; this file only composes them. New
 * modules (lessons, subscriptions, search, research) mount here as they are built
 * (§8 modular monolith).
 */

import { Router } from 'express';
import { authRouter } from '@/modules/auth/auth.routes';
import { invitesRouter } from '@/modules/invites/invites.routes';
import { usersRouter } from '@/modules/users/users.routes';
import { recordingsRouter } from '@/modules/recordings/recordings.routes';
import { lessonsRouter } from '@/modules/lessons/lessons.routes';
import { educationRouter } from '@/modules/education/education.routes';
import { coursesRouter } from '@/modules/courses/courses.routes';
import { studioRouter } from '@/modules/studio/studio.routes';
import { searchRouter } from '@/modules/search/search.routes';
import { subscriptionsRouter } from '@/modules/subscriptions/subscriptions.routes';
import { notificationsRouter } from '@/modules/notifications/notifications.routes';
import { organizationsRouter } from '@/modules/organizations/organizations.routes';
import { commentsRouter } from '@/modules/comments/comments.routes';
import { collectionsRouter } from '@/modules/collections/collections.routes';
import { libraryRouter } from '@/modules/library/library.routes';
import { researchRouter } from '@/modules/research/research.routes';
import { generationRouter } from '@/modules/generation/generation.routes';
import { internalRouter } from '@/modules/internal/internal.routes';

export const apiV1Router: Router = Router();

apiV1Router.use('/auth', authRouter);
// Admin-only invite codes — registration is invite-gated (SESSION "private access").
apiV1Router.use('/invites', invitesRouter);
apiV1Router.use('/users', usersRouter);
apiV1Router.use('/recordings', recordingsRouter);
apiV1Router.use('/lessons', lessonsRouter);
// Educator-authored lessons/resources (public reads, educator-gated authoring).
apiV1Router.use('/education', educationRouter);
// Structured curricula (Stage 4) — authored courses + per-user progress.
apiV1Router.use('/courses', coursesRouter);
// DAW project sync (Stage 5) — compositions follow the member across devices.
apiV1Router.use('/studio', studioRouter);
apiV1Router.use('/search', searchRouter);
apiV1Router.use('/subscriptions', subscriptionsRouter);
apiV1Router.use('/notifications', notificationsRouter);
apiV1Router.use('/organizations', organizationsRouter);
apiV1Router.use('/comments', commentsRouter);
apiV1Router.use('/collections', collectionsRouter);
apiV1Router.use('/library', libraryRouter);
apiV1Router.use('/research', researchRouter);
apiV1Router.use('/generate', generationRouter);
// Service-to-service only (AI pipeline callbacks) — internal-key auth, not JWT.
apiV1Router.use('/internal', internalRouter);
