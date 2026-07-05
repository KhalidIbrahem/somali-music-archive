/**
 * Side-effect module: load `.env` into process.env before anything reads config.
 *
 * Imported as the FIRST import in the process entry point (server.ts). ESM
 * evaluates imports in order, so importing this before `@/config/env` guarantees
 * the file is loaded before the environment is validated. Kept separate from
 * loadEnv.ts so those functions stay pure and unit-testable.
 */

import { loadEnvFile } from './loadEnv';

loadEnvFile();
