import { v4 as uuid } from 'uuid';
import { llm } from '../llm/llm-client.js';
import { db } from '../database/connections.js';
import type { ReflectionMemory, BehavioralDirective } from '../memory/types.js';

/**
 * Behavior Engine — bridges reflections to concrete behavioral changes.
 *
 * When the reflection engine generates a new reflection (e.g., "user seems to
 * prefer short answers"), the behavior engine extracts an actionable directive
 * that can influence:
 *   - Retrieval biases (e.g., prioritize concise memories)
 *   - Prompt style (e.g., "be concise", "include code examples")
 *   - Content preferences (e.g., "use comparison tables over prose")
 *
 * Directives are stored in PostgreSQL and cached in-memory for fast access.
 */
export class BehaviorEngine {
    private directiveCache: BehavioralDirective[] | null = null;
    private lastCacheRefresh = 0;
    private readonly CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

    // ====================================================================
    // EXTRACT
    // ====================================================================

    /**
     * Extract actionable behavioral directives from a set of reflections.
     *
     * Uses the LLM to parse reflection content into typed directives.
     * Only persists genuinely actionable ones (filters out vague observations).
     */
    async extractDirectives(reflections: ReflectionMemory[]): Promise<BehavioralDirective[]> {
        if (reflections.length === 0) return [];

        const reflectionSummary = reflections
            .map((r, i) => `${i + 1}. Lesson: ${r.lessonLearned}\n   Strategy: ${r.strategyImprovement}`)
            .join('\n');

        try {
            const result = await llm.chatJSON<{
                directives: Array<{
                    type: 'retrieval_bias' | 'prompt_style' | 'content_preference';
                    directive: string;
                    weight: number;
                    reasoning: string;
                }>;
            }>([
                {
                    role: 'system',
                    content: `You are a behavioral analysis engine. Extract actionable behavioral directives from reflection data.

Directive types:
- retrieval_bias: Influences which memories are prioritized (e.g., "prioritize recent coding examples")
- prompt_style: Changes how the agent communicates (e.g., "keep responses under 3 paragraphs")
- content_preference: Affects content format/structure (e.g., "use comparison tables when explaining alternatives")

Output only genuinely actionable directives, not vague observations.`,
                },
                {
                    role: 'user',
                    content: `Extract behavioral directives from these reflections:

${reflectionSummary}

Respond as JSON:
{
  "directives": [
    {
      "type": "retrieval_bias" | "prompt_style" | "content_preference",
      "directive": "concise, actionable instruction",
      "weight": 0.0-1.0 (how strongly to apply),
      "reasoning": "why this directive was extracted"
    }
  ]
}

Return an empty array if no actionable directives can be extracted.`,
                },
            ]);

            const stored: BehavioralDirective[] = [];

            for (const d of result.directives) {
                // Validate weight range
                const weight = Math.max(0, Math.min(1, d.weight));

                const directive: BehavioralDirective = {
                    id: uuid(),
                    type: d.type,
                    directive: d.directive,
                    weight,
                    source_reflection_id: reflections[0]?.id ?? '',
                    active: true,
                    created_at: new Date().toISOString(),
                };

                // Persist to PostgreSQL
                await db.pg.query(
                    `INSERT INTO behavioral_directives (id, type, directive, weight, source_reflection_id, active)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [directive.id, directive.type, directive.directive, directive.weight, directive.source_reflection_id || null, directive.active],
                );

                stored.push(directive);
            }

            // Invalidate cache
            this.directiveCache = null;

            if (stored.length > 0) {
                console.log(`  🎯 Extracted ${stored.length} behavioral directive(s)`);
            }

            return stored;
        } catch (error) {
            console.error('Behavioral directive extraction failed:', error);
            return [];
        }
    }

    // ====================================================================
    // READ
    // ====================================================================

    /** Get all currently active behavioral directives */
    async getActiveDirectives(): Promise<BehavioralDirective[]> {
        const now = Date.now();
        if (this.directiveCache && now - this.lastCacheRefresh < this.CACHE_TTL_MS) {
            return this.directiveCache;
        }

        const { rows } = await db.pg.query(
            `SELECT * FROM behavioral_directives
             WHERE active = true
             ORDER BY weight DESC, created_at DESC
             LIMIT 20`,
        );

        this.directiveCache = rows.map(this.rowToDirective);
        this.lastCacheRefresh = now;
        return this.directiveCache;
    }

    /** Get directives filtered by type */
    async getDirectivesByType(
        type: BehavioralDirective['type'],
    ): Promise<BehavioralDirective[]> {
        const all = await this.getActiveDirectives();
        return all.filter((d) => d.type === type);
    }

    // ====================================================================
    // MODIFY RETRIEVAL — Directive-driven query adjustment
    // ====================================================================

    /**
     * Apply retrieval bias directives to a retrieval query.
     *
     * Returns additional query context that should be appended to the retrieval
     * query to bias results toward what the directives suggest.
     */
    async getRetrievalBiasContext(): Promise<string | null> {
        const biases = await this.getDirectivesByType('retrieval_bias');
        if (biases.length === 0) return null;

        // Build a bias string that can be appended to retrieval query
        const biasTerms = biases
            .sort((a, b) => b.weight - a.weight)
            .slice(0, 3)
            .map((b) => b.directive)
            .join('. ');

        return biasTerms;
    }

    // ====================================================================
    // MANAGE
    // ====================================================================

    /** Deactivate a directive */
    async deactivate(directiveId: string): Promise<void> {
        await db.pg.query(
            'UPDATE behavioral_directives SET active = false WHERE id = $1',
            [directiveId],
        );
        this.directiveCache = null;
    }

    /** Deactivate all directives of a given type */
    async deactivateByType(type: BehavioralDirective['type']): Promise<void> {
        await db.pg.query(
            'UPDATE behavioral_directives SET active = false WHERE type = $1',
            [type],
        );
        this.directiveCache = null;
    }

    // ====================================================================
    // HELPERS
    // ====================================================================

    private rowToDirective(row: Record<string, unknown>): BehavioralDirective {
        return {
            id: row.id as string,
            type: row.type as BehavioralDirective['type'],
            directive: row.directive as string,
            weight: row.weight as number,
            source_reflection_id: (row.source_reflection_id as string) ?? '',
            active: row.active as boolean,
            created_at: (row.created_at as Date).toISOString(),
        };
    }
}
