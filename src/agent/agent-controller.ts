import { llm } from '../llm/llm-client.js';
import { MemoryManager } from '../memory/memory-manager.js';
import { ReflectionEngine } from '../reflection/reflection-engine.js';
import { PromptBuilder } from './prompt-builder.js';

/**
 * Agent Controller — main orchestration loop.
 *
 * Flow per interaction:
 *   1. Retrieve relevant memories
 *   2. Build memory-augmented prompt
 *   3. Send to LLM
 *   4. Process response through memory pipeline
 *   5. Trigger reflection on important interactions
 */
export class AgentController {
    private memory: MemoryManager;
    private reflection: ReflectionEngine;
    private promptBuilder: PromptBuilder;

    constructor(sessionId?: string) {
        this.memory = new MemoryManager(sessionId);
        this.reflection = new ReflectionEngine(
            this.memory.reflection,
            this.memory.knowledgeGraph,
        );
        this.promptBuilder = new PromptBuilder();
    }

    getSessionId(): string {
        return this.memory.working.getSessionId();
    }

    /**
     * Process a user message and return the agent's response (non-streaming).
     */
    async chat(userMessage: string): Promise<string> {
        try {
            const memories = await this.memory.retrieve({ query: userMessage });
            console.log(`  🧠 Retrieved ${memories.length} memories (top score: ${memories[0]?.score.totalScore.toFixed(3) ?? 'N/A'})`);

            const history = await this.memory.working.getMessages();
            const messages = this.promptBuilder.buildMessages(userMessage, history, memories);
            const response = await llm.chat(messages);

            await this.memory.processInteraction(userMessage, response);
            await this.maybeReflect();

            return response;
        } catch (error) {
            console.error('Agent chat error:', error);
            await this.memory.episodic.store({
                eventType: 'error',
                sessionId: this.memory.working.getSessionId(),
                content: `Error processing: ${userMessage}. Error: ${error}`,
                result: 'failure',
                importance: 0.8,
                metadata: { error: String(error) },
            });
            return 'I encountered an error processing your request. Could you try rephrasing?';
        }
    }

    /**
     * Stream a chat response token by token via SSE-compatible events.
     * Yields: { type: 'memory' } → { type: 'token' }... → { type: 'done' }
     * Memory pipeline runs after the stream completes.
     */
    async *chatStream(userMessage: string): AsyncGenerator<
        | { type: 'memory'; count: number; topScore: number | null }
        | { type: 'token'; content: string }
        | { type: 'done'; fullResponse: string }
    > {
        // 1. Retrieve relevant memories
        const memories = await this.memory.retrieve({ query: userMessage });
        console.log(`  🧠 Retrieved ${memories.length} memories (top score: ${memories[0]?.score.totalScore.toFixed(3) ?? 'N/A'})`);

        yield {
            type: 'memory',
            count: memories.length,
            topScore: memories[0]?.score.totalScore ?? null,
        };

        // 2. Get history + build prompt
        const history = await this.memory.working.getMessages();
        const messages = this.promptBuilder.buildMessages(userMessage, history, memories);

        // 3. Stream LLM response
        let fullResponse = '';
        for await (const token of llm.chatStream(messages)) {
            fullResponse += token;
            yield { type: 'token', content: token };
        }

        yield { type: 'done', fullResponse };

        // 4. Process memory pipeline (after stream completes)
        try {
            await this.memory.processInteraction(userMessage, fullResponse);
            await this.maybeReflect();
        } catch (error) {
            console.error('Memory pipeline error (post-stream):', error);
        }
    }

    /** Trigger reflection every 5th interaction */
    private async maybeReflect(): Promise<void> {
        const stats = await this.memory.getStats();
        if (stats.interactions % 5 === 0) {
            const recentEpisodes = await this.memory.episodic.getRecent(5);
            const reflections = await this.reflection.reflectOnRecent(recentEpisodes);
            if (reflections.length > 0) {
                console.log(`  💭 Generated ${reflections.length} reflection(s)`);
            }
        }
    }

    /** Get memory system statistics */
    async getStats(): Promise<Record<string, number>> {
        return this.memory.getStats();
    }

    /** Get the underlying memory manager for direct API access */
    getMemoryManager(): MemoryManager {
        return this.memory;
    }

    /** Force a memory consolidation cycle */
    async consolidate(): Promise<void> {
        await this.memory.consolidation.consolidate();
    }
}
