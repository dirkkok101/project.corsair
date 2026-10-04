import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Ship frames are read straight from art/ at the repo root, so the dev server must be allowed there.
const repoRoot = fileURLToPath(new URL('../..', import.meta.url));

export default defineConfig({
  // Preact's JSX runtime; without this the dependency scanner looks for react/jsx-dev-runtime.
  oxc: { jsx: { importSource: 'preact' } },
  server: { fs: { allow: [repoRoot] } },
});
