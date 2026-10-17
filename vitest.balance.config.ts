import { defineConfig } from 'vitest/config';

// The balance suite: how the game comes out over many seeds and long runs (pirate pressure, a year's economy, the
// trade winds, how fights go). Slow and statistical, so not in the merge gate (`verify`); run it with
// `pnpm verify:balance` before merging a change to the tuning (traffic, combat, economy, navigation or weather
// settings, or the systems that use them).
export default defineConfig({ test: { include: ['packages/*/balance/**/*.test.ts'], testTimeout: 1_800_000 } });
