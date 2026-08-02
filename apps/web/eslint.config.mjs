/**
 * ESLint flat config (Next.js 16 dropped `next lint`; `eslint .` runs this).
 * eslint-config-next v16 ships native flat-config arrays.
 */
import coreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...coreWebVitals,
  {
    ignores: ['.next/**', 'node_modules/**', '.turbo/**'],
  },
];

export default config;
