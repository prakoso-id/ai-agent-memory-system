import type { ConversationMessage, RetrievedMemory } from '../memory/types.js';

/**
 * Prompt Builder — constructs memory-augmented prompts.
 * Injects relevant memories into the system prompt while keeping total size minimal.
 */
export class PromptBuilder {
    private readonly systemBase = `You are a helpful AI assistant with persistent memory. You can remember information from past conversations and learn from experience.

When you recall relevant memories, incorporate them naturally into your responses. Do not explicitly say "I found this in my memory" — just use the knowledge naturally, as a helpful assistant would.

If you remember user preferences, apply them. If you've learned lessons from past mistakes, use those strategies.`;

    /** Build the full message array for LLM chat */
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
