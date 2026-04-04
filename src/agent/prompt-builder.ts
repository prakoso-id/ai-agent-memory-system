import type {
    ConversationMessage,
    RetrievedMemory,
    BuiltContext,
    BehavioralDirective,
    StrategyMemory,
    CompressedMemory,
} from '../memory/types.js';

/**
 * Prompt Builder — constructs memory-augmented prompts.
 *
 * Phase 2 upgrade:
 *   • Accepts BuiltContext (compressed, token-budgeted) instead of raw memories
 *   • Injects strategy memories as a dedicated prompt section
 *   • Injects behavioral directives as system-level instructions
 *   • Falls back to raw RetrievedMemory[] for backward compatibility
 */
export class PromptBuilder {
    private readonly systemBase = `You are a helpful AI assistant with persistent memory. You can remember information from past conversations and learn from experience.

When you recall relevant memories, incorporate them naturally into your responses. Do not explicitly say "I found this in my memory" — just use the knowledge naturally, as a helpful assistant would.

If you remember user preferences, apply them. If you've learned lessons from past mistakes, use those strategies.`;

    // ====================================================================
    // PUBLIC API
    // ====================================================================

    /**
     * Build the full message array for LLM chat using BuiltContext (Phase 2).
     */
    buildMessagesFromContext(
        userMessage: string,
        conversationHistory: ConversationMessage[],
        context: BuiltContext,
    ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

        // System prompt with injected memories, strategies, and directives
        messages.push({
            role: 'system',
            content: this.buildContextAwarePrompt(context),
        });

        // Recent conversation history (last 10 messages max for context window management)
        const recentHistory = conversationHistory.slice(-10);
        for (const msg of recentHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }

        // Current user message
        messages.push({ role: 'user', content: userMessage });

        return messages;
    }

    /**
     * Build the full message array for LLM chat (Phase 1 backward-compatible).
     */
    buildMessages(
        userMessage: string,
        conversationHistory: ConversationMessage[],
        memories: RetrievedMemory[],
    ): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> {
        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [];

        // System prompt with injected memories
        messages.push({
            role: 'system',
            content: this.buildSystemPrompt(memories),
        });

        // Recent conversation history (last 10 messages max for context window management)
        const recentHistory = conversationHistory.slice(-10);
        for (const msg of recentHistory) {
            messages.push({ role: msg.role, content: msg.content });
        }

        // Current user message
        messages.push({ role: 'user', content: userMessage });

        return messages;
    }

    // ====================================================================
    // PHASE 2 — Context-Aware Prompt Building
    // ====================================================================

    /** Build the system prompt from BuiltContext (memories + strategies + directives) */
    private buildContextAwarePrompt(context: BuiltContext): string {
        const sections: string[] = [this.systemBase];

        // Behavioral directives — injected as instructions
        if (context.directives.length > 0) {
            sections.push(this.formatDirectives(context.directives));
        }

        // Memories — grouped by source, using compressed content
        if (context.memories.length > 0) {
            sections.push(this.formatCompressedMemories(context.memories));
        }

        // Strategies — reusable patterns
        if (context.strategies.length > 0) {
            sections.push(this.formatStrategies(context.strategies));
        }

        return sections.join('\n\n');
    }

    /** Format behavioral directives as system-level instructions */
    private formatDirectives(directives: BehavioralDirective[]): string {
        const lines = directives.map((d) => {
            const icon = d.type === 'prompt_style' ? '✏️'
                : d.type === 'content_preference' ? '📋'
                : '🎯';
            return `  ${icon} ${d.directive}`;
        });

        return `=== BEHAVIORAL GUIDELINES ===
Based on learned preferences and past interactions:

${lines.join('\n')}
=== END GUIDELINES ===`;
    }

    /** Format compressed memories into a readable prompt section */
    private formatCompressedMemories(memories: CompressedMemory[]): string {
        const sections: string[] = [];

        // Group by source
        const semantic = memories.filter((m) => m.memory.source === 'semantic');
        const reflections = memories.filter((m) => m.memory.source === 'reflection');
        const graphMemories = memories.filter((m) => m.memory.source === 'knowledge_graph');

        if (semantic.length > 0) {
            sections.push(
                '📝 Knowledge:\n' +
                semantic.map((m) => `  • ${m.compressedContent}`).join('\n'),
            );
        }

        if (reflections.length > 0) {
            sections.push(
                '💡 Lessons Learned:\n' +
                reflections.map((m) => `  • ${m.compressedContent}`).join('\n'),
            );
        }

        if (graphMemories.length > 0) {
            sections.push(
                '🔗 Relationships:\n' +
                graphMemories.map((m) => `  • ${m.compressedContent}`).join('\n'),
            );
        }

        return `=== YOUR MEMORIES ===
The following are your relevant memories from past interactions. Use them to provide better, more personalized responses.

${sections.join('\n\n')}
=== END MEMORIES ===`;
    }

    /** Format strategy memories */
    private formatStrategies(strategies: StrategyMemory[]): string {
        const lines = strategies.map((s) =>
            `  • ${s.pattern} (effectiveness: ${(s.effectiveness * 100).toFixed(0)}%)`,
        );

        return `=== LEARNED STRATEGIES ===
These patterns have been effective in past interactions:

${lines.join('\n')}
=== END STRATEGIES ===`;
    }

    // ====================================================================
    // PHASE 1 — Legacy Prompt Building (backward-compatible)
    // ====================================================================

    /** Build the system prompt with memory injection */
    private buildSystemPrompt(memories: RetrievedMemory[]): string {
        if (memories.length === 0) return this.systemBase;

        const memorySection = this.formatMemories(memories);

        return `${this.systemBase}

=== YOUR MEMORIES ===
The following are your relevant memories from past interactions. Use them to provide better, more personalized responses.

${memorySection}
=== END MEMORIES ===`;
    }

    /** Format retrieved memories into a readable prompt section */
    private formatMemories(memories: RetrievedMemory[]): string {
        const sections: string[] = [];

        // Group by source
        const semantic = memories.filter((m) => m.source === 'semantic');
        const reflections = memories.filter((m) => m.source === 'reflection');
        const graphMemories = memories.filter((m) => m.source === 'knowledge_graph');

        if (semantic.length > 0) {
            sections.push(
                '📝 Knowledge:\n' +
                semantic.map((m) => `  • ${m.memory.content}`).join('\n'),
            );
        }

        if (reflections.length > 0) {
            sections.push(
                '💡 Lessons Learned:\n' +
                reflections.map((m) => `  • ${m.memory.content}`).join('\n'),
            );
        }

        if (graphMemories.length > 0) {
            sections.push(
                '🔗 Relationships:\n' +
                graphMemories.map((m) => `  • ${m.memory.content}`).join('\n'),
            );
        }

        return sections.join('\n\n');
    }
}
