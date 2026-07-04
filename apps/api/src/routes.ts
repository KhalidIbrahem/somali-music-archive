/**
 * The versioned API router (ARCHITECTURE.md §12 — everything under /api/v1).
 *
 * Each feature module owns its own router; this file only composes them. New
 * modules (lessons, subscriptions, search, research) mount here as they are built
 * (§8 modular monolith).
 */

import { Router } from 'express';
import { authRouter } from '@/modules/auth/auth.routes';
import { usersRouter } from '@/modules/users/users.routes';
import { recordingsRouter } from '@/modules/recordings/recordings.routes';
import { lessonsRouter } from '@/modules/lessons/lessons.routes';
import { searchRouter } from '@/modules/search/search.routes';
import { subscriptionsRouter } from '@/modules/subscriptions/subscriptions.routes';
import { notificationsRouter } from '@/modules/notifications/notifications.routes';
import { internalRouter } from '@/modules/internal/internal.routes';

export const apiV1Router: Router = Router();

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/users', usersRouter);
apiV1Router.use('/recordings', recordingsRouter);
apiV1Router.use('/lessons', lessonsRouter);
apiV1Router.use('/search', searchRouter);
apiV1Router.use('/subscriptions', subscriptionsRouter);
apiV1Router.use('/notifications', notificationsRouter);
// Service-to-service only (AI pipeline callbacks) — internal-key auth, not JWT.
apiV1Router.use('/internal', internalRouter);
