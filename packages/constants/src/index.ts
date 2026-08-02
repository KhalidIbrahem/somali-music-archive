/**
 * @sma/constants — barrel export.
 *
 * Every folder in this monorepo has an index file so that imports stay stable
 * and short (`import { GENRES } from '@sma/constants'`) even as the internal
 * file layout evolves. This file is the public surface of the package.
 */

export * from './genres';
export * from './regions';
export * from './languages';
export * from './instruments';
export * from './generation';
