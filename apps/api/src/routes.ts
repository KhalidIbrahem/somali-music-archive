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

export const apiV1Router: Router = Router();

apiV1Router.use('/auth', authRouter);
apiV1Router.use('/users', usersRouter);
apiV1Router.use('/recordings', recordingsRouter);
