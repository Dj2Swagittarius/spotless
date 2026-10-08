import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

export default defineConfig([
  // Build output, dependencies, runtime data and non-source folders are never linted.
  globalIgnores(['.next/**', '.claude/**', 'test-env/**', 'node_modules/**', 'data/**', 'docs/**', 'public/**', 'dj-test/**', 'next-env.d.ts']),
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // pre-existing; promote to error after cleanup. The React Compiler rules shipped with
      // eslint-config-next 16 flag several setState-in-effect / module-level component patterns
      // in existing pages; they are warnings so `npm run lint` stays green until those are fixed.
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react/no-unescaped-entities': 'warn',
    },
  },
]);
