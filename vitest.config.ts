import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/tests/**/*.test.ts'],
        globals: false,
        // LLM calls (embeddings + compression + reflection) can be slow on free-tier APIs
        testTimeout: 180_000,
        hookTimeout: 180_000,
        // Run test files serially — they share real DB connections
        pool: 'forks',
        poolOptions: {
            forks: { singleFork: true },
        },
        // Pretty reporter: print each test name even on pass
        reporters: 'verbose',
    },
});
