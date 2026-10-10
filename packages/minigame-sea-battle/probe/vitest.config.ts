import { defineConfig } from 'vitest/config';

// The balance probes: run by hand, never in the gate.
export default defineConfig({ test: { include: ['**/*.test.ts'], testTimeout: 3_600_000 } });
