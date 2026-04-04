/**
 * TC-007 — Reflection Impact: Behavioral Directives Shape Context
 *
 * GOAL: Prove that reflections produce behavioral directives that
 *       actually influence prompt building and context assembly.
 *
 *   Input:
 *     Reflection berisi: "User prefers short, concise explanations"
 *
 *   Expected:
 *     • BehaviorEngine extracts a 'prompt_style' directive
 *     • Directive muncul di active directives
 *     • PromptBuilder menyuntikkan directive ke system prompt
 *     • Prompt yang dihasilkan mengandung instruksi "concise/short"
 *
 *   Kalau masih panjang dan nggak ada directive:
 *     👉 reflection lo cuma diary anak SMA
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { BehaviorEngine } from '../reflection/behavior-engine.js';
import { PromptBuilder } from '../agent/prompt-builder.js';
import { StrategyMemoryService } from '../memory/strategy-memory.js';
import type { ReflectionMemory, BuiltContext, CompressedMemory, RetrievedMemory } from '../memory/types.js';
import { initDb, cleanupDirectives, cleanupStrategies, uniqueTag } from './helpers.js';

const TAG = uniqueTag('tc-007');
const behaviorEngine = new BehaviorEngine();
const promptBuilder = new PromptBuilder();
const strategyService = new StrategyMemoryService();

const directiveIds: string[] = [];
const strategyIds: string[] = [];

// Build a fake reflection that says "user prefers short answers"
function makeConciseReflection(): ReflectionMemory {
    return {
        id: `refl-${TAG}-001`,
        content: 'Reflection on: coding assistance conversation',
        observation: 'User frequently asked for shorter responses and got frustrated with long explanations',
        rootCause: 'The agent provided overly verbose explanations when the user wanted quick answers',
        lessonLearned: 'User strongly prefers short, concise explanations over long-winded prose',
        strategyImprovement: 'Keep responses under 3 paragraphs. Use bullet points instead of long sentences. Get to the point fast.',
        relatedEpisodeIds: [],
        importance: 0.85,
        usage_count: 0,
        last_accessed: new Date().toISOString(),
        tags: ['user_preference', 'response_style'],
        metadata: { testSession: TAG },
        timestamp: new Date().toISOString(),
    };
}

// Build a fake reflection about preferring code examples
function makeCodePreferenceReflection(): ReflectionMemory {
    return {
        id: `refl-${TAG}-002`,
        content: 'Reflection on: technical question',
        observation: 'User always asks "can you show me the code?" after text-only explanations',
        rootCause: 'Text explanations without code examples are not sufficient for this user',
        lessonLearned: 'User learns better from code examples than from prose descriptions',
        strategyImprovement: 'Always include working code examples alongside any technical explanation. Lead with code, then explain.',
        relatedEpisodeIds: [],
        importance: 0.80,
        usage_count: 0,
        last_accessed: new Date().toISOString(),
        tags: ['user_preference', 'content_format'],
        metadata: { testSession: TAG },
        timestamp: new Date().toISOString(),
    };
}

beforeAll(async () => {
    await initDb();
});

afterAll(async () => {
    await cleanupDirectives(directiveIds);
    await cleanupStrategies(strategyIds);
});

// ── Helper: build a minimal BuiltContext ────────────────────────────────────

function makeBuiltContext(
    directives: { type: 'retrieval_bias' | 'prompt_style' | 'content_preference'; directive: string; weight: number }[],
): BuiltContext {
    const fakeMemory: RetrievedMemory = {
        memory: {
            id: 'fake-mem-1',
            content: 'The project uses TypeScript.',
            timestamp: new Date().toISOString(),
            importance: 0.8,
            usage_count: 1,
            last_accessed: new Date().toISOString(),
            tags: ['typescript'],
            metadata: {},
        },
        source: 'semantic',
        score: { memoryId: 'fake-mem-1', semanticSimilarity: 0.9, recency: 0.8, importance: 0.8, taskRelevance: 0.7, totalScore: 0.8 },
    };

    const compressed: CompressedMemory = {
        memory: fakeMemory,
        tier: 'raw',
        compressedContent: fakeMemory.memory.content,
        originalTokens: 6,
        compressedTokens: 6,
    };

    return {
        memories: [compressed],
        strategies: [],
        directives: directives.map((d, i) => ({
            id: `dir-${i}`,
            type: d.type,
            directive: d.directive,
            weight: d.weight,
            source_reflection_id: 'test',
            active: true,
            created_at: new Date().toISOString(),
        })),
        totalTokens: 50,
        compressionApplied: false,
    };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('TC-007 — Reflection Impact: Behavioral Directives', () => {

    // ═══════════════════════════════════════════════════════════════════════
    // 1. DIRECTIVE EXTRACTION — reflections produce real directives
    // ═══════════════════════════════════════════════════════════════════════

    describe('directive extraction from reflections', () => {
        let extractedDirectives: Awaited<ReturnType<typeof behaviorEngine.extractDirectives>>;

        beforeAll(async () => {
            const reflections = [makeConciseReflection(), makeCodePreferenceReflection()];
            extractedDirectives = await behaviorEngine.extractDirectives(reflections);
            directiveIds.push(...extractedDirectives.map((d) => d.id));
        });

        it('extracts at least 1 directive from the reflections', () => {
            expect(extractedDirectives.length).toBeGreaterThanOrEqual(1);
            console.log(`    Extracted ${extractedDirectives.length} directive(s)`);
        });

        it('all directives have valid types', () => {
            const validTypes = ['retrieval_bias', 'prompt_style', 'content_preference'];
            for (const d of extractedDirectives) {
                expect(validTypes).toContain(d.type);
            }
        });

        it('all directives have weight between 0 and 1', () => {
            for (const d of extractedDirectives) {
                expect(d.weight).toBeGreaterThanOrEqual(0);
                expect(d.weight).toBeLessThanOrEqual(1);
            }
        });

        it('at least one directive relates to conciseness or short responses', () => {
            const conciseRelated = extractedDirectives.some((d) => {
                const lower = d.directive.toLowerCase();
                return lower.includes('concis') || lower.includes('short') ||
                    lower.includes('brief') || lower.includes('bullet') ||
                    lower.includes('paragraph');
            });
            expect(conciseRelated).toBe(true);
            console.log('    ✅ Found conciseness-related directive');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 2. DIRECTIVES PERSIST — they survive a re-read
    // ═══════════════════════════════════════════════════════════════════════

    describe('directives are persisted and retrievable', () => {
        it('getActiveDirectives() returns the stored directives', async () => {
            const active = await behaviorEngine.getActiveDirectives();
            const ours = active.filter((d) => directiveIds.includes(d.id));
            expect(ours.length).toBeGreaterThanOrEqual(1);
        });

        it('directives are marked active=true', async () => {
            const active = await behaviorEngine.getActiveDirectives();
            for (const d of active) {
                expect(d.active).toBe(true);
            }
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 3. PROMPT INJECTION — directives appear in the system prompt
    // ═══════════════════════════════════════════════════════════════════════

    describe('prompts include behavioral directives', () => {
        it('buildMessagesFromContext() includes BEHAVIORAL GUIDELINES section', () => {
            const ctx = makeBuiltContext([
                { type: 'prompt_style', directive: 'Keep responses concise and under 3 paragraphs', weight: 0.9 },
            ]);

            const messages = promptBuilder.buildMessagesFromContext('hello', [], ctx);
            const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';

            expect(systemPrompt).toContain('BEHAVIORAL GUIDELINES');
            expect(systemPrompt).toContain('concise');
        });

        it('system prompt WITHOUT directives does NOT contain BEHAVIORAL GUIDELINES', () => {
            const ctx = makeBuiltContext([]);

            const messages = promptBuilder.buildMessagesFromContext('hello', [], ctx);
            const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';

            expect(systemPrompt).not.toContain('BEHAVIORAL GUIDELINES');
        });

        it('multiple directives all appear in the prompt', () => {
            const ctx = makeBuiltContext([
                { type: 'prompt_style', directive: 'Be concise and direct', weight: 0.9 },
                { type: 'content_preference', directive: 'Always include code examples', weight: 0.8 },
            ]);

            const messages = promptBuilder.buildMessagesFromContext('hello', [], ctx);
            const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';

            expect(systemPrompt).toContain('concise');
            expect(systemPrompt).toContain('code examples');
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 4. STRATEGY INJECTION — strategies appear in prompt
    // ═══════════════════════════════════════════════════════════════════════

    describe('strategy memory integration', () => {
        let storedStrategyId: string;

        beforeAll(async () => {
            const s = await strategyService.store({
                pattern: 'Use comparison tables for feature comparisons instead of prose',
                evidence: 'Users prefer visual structure for comparing options',
                effectiveness: 0.85,
                domain: 'content_format',
                metadata: { testTag: TAG },
            });
            storedStrategyId = s.id;
            strategyIds.push(s.id);
        });

        it('strategy is stored and retrievable', async () => {
            const retrieved = await strategyService.getById(storedStrategyId);
            expect(retrieved).not.toBeNull();
            expect(retrieved!.pattern).toContain('comparison tables');
        });

        it('buildMessagesFromContext() includes LEARNED STRATEGIES section', () => {
            const ctx: BuiltContext = {
                memories: [],
                strategies: [{
                    id: storedStrategyId,
                    pattern: 'Use comparison tables for feature comparisons',
                    evidence: 'test',
                    effectiveness: 0.85,
                    domain: 'content_format',
                    usage_count: 0,
                    last_validated: new Date().toISOString(),
                    created_at: new Date().toISOString(),
                    metadata: {},
                }],
                directives: [],
                totalTokens: 20,
                compressionApplied: false,
            };

            const messages = promptBuilder.buildMessagesFromContext('hello', [], ctx);
            const systemPrompt = messages.find((m) => m.role === 'system')?.content ?? '';

            expect(systemPrompt).toContain('LEARNED STRATEGIES');
            expect(systemPrompt).toContain('comparison tables');
            expect(systemPrompt).toContain('85%'); // effectiveness percentage
        });

        it('strategy effectiveness updates on outcome recording', async () => {
            const before = await strategyService.getById(storedStrategyId);
            await strategyService.recordOutcome(storedStrategyId, true); // effective
            const after = await strategyService.getById(storedStrategyId);

            expect(after!.effectiveness).toBeGreaterThan(before!.effectiveness);
            expect(after!.usage_count).toBe(before!.usage_count + 1);
        });
    });

    // ═══════════════════════════════════════════════════════════════════════
    // 5. DEACTIVATION — directives can be turned off
    // ═══════════════════════════════════════════════════════════════════════

    describe('directive lifecycle', () => {
        it('deactivated directives do not appear in active list', async () => {
            // Create a test directive
            const directives = await behaviorEngine.extractDirectives([makeConciseReflection()]);
            if (directives.length > 0) {
                const targetId = directives[0]!.id;
                directiveIds.push(targetId);

                await behaviorEngine.deactivate(targetId);

                const active = await behaviorEngine.getActiveDirectives();
                const found = active.find((d) => d.id === targetId);
                expect(found).toBeUndefined();
            }
        });
    });
});
