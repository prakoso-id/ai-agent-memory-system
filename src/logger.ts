import pino from 'pino';

/**
 * Shared structured logger — ENH-003.
 *
 * Outputs JSON to stdout. Pipe through `pino-pretty` in dev for human-readable output.
 * Log level controlled by LOG_LEVEL env var (default: 'info').
 * In test environment (VITEST=true / NODE_ENV=test), level is 'silent'.
 */
const isTest = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';

export const logger = pino({
    level: isTest ? 'silent' : (process.env.LOG_LEVEL ?? 'info'),
    base: { service: 'ai-agent-memory' },
    timestamp: pino.stdTimeFunctions.isoTime,
});

/** Child logger factory — adds a persistent `component` field to every log line */
export function createLogger(component: string) {
    return logger.child({ component });
}
