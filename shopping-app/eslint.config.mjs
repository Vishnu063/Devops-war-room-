import { createRequire } from 'node:module';
const require = createRequire(new URL('./backend/package.json', import.meta.url));
const js = require('@eslint/js'),
  globals = require('globals');
export default [
  { ignores: ['**/node_modules/**', '**/test-artifacts/**'] },
  js.configs.recommended,
  {
    files: ['backend/**/*.mjs', 'deploy/**/*.mjs', 'eslint.config.mjs'],
    languageOptions: { globals: globals.node },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
  {
    files: ['*.js', 'backend/test/browser/**/*.mjs'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }] },
  },
];
