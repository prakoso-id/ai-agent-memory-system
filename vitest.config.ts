import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['src/tests/**/*.test.ts'],
        globals: false,
        // LLM embedding calls can be slow
        testTimeout: 60_000,
        hookTimeout: 30_000,
        // Run test files serially — they share real DB connections
        pool: 'forks',
        poolOptions: {
            forks: { singleFork: true },
        },
        // Pretty reporter: print each test name even on pass
        reporter: 'verbose',
    },
});
