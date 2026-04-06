import { llm } from '../llm/llm-client.js';
import { config } from '../config/index.js';
import { v4 as uuid } from 'uuid';
import { MemoryManager } from '../memory/memory-manager.js';
import { ReflectionEngine } from '../reflection/reflection-engine.js';
import { ContextBuilder } from './context-builder.js';
import { PromptBuilder } from './prompt-builder.js';
import { BehaviorEngine } from '../reflection/behavior-engine.js';

/**
 * Agent Controller — main orchestration loop.
 *
 * Flow per interaction:
 *   1. Build token-budgeted context (Phase 2: ContextBuilder)
 *   2. Build memory-augmented prompt (with strategies + directives)
 *   3. Send to LLM
 *   4. Process response through memory pipeline
 *   5. Trigger reflection on important interactions
 *
 * Phase 2 additions:
 *   • ContextBuilder for token-aware context assembly
 *   • Strategy + directive injection into prompts
 *   • Retrieval feedback recording
 */
export class AgentController {
    private memory: MemoryManager;
    private reflection: ReflectionEngine;
    private contextBuilder: ContextBuilder;
    private promptBuilder: PromptBuilder;

    constructor(sessionId?: string) {
        this.memory = new MemoryManager(sessionId);
        this.reflection = new ReflectionEngine(
            this.memory.reflection,
            this.memory.knowledgeGraph,
            this.memory.strategies,
        );
        this.contextBuilder = new ContextBuilder(
            this.memory,
            this.memory.strategies,
            this.reflection.behavior,
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
            // Phase 2: Build token-budgeted context
            const context = await this.contextBuilder.buildContext({
                query: userMessage,
                max_tokens: config.contextBuilder.defaultMaxTokens,
                priority: ['relevant', 'important', 'recent'],
                include_strategies: true,
                include_directives: true,
            });

            console.log(
                `  🧠 Context: ${context.memories.length} memories, ` +
                `${context.strategies.length} strategies, ` +
                `${context.directives.length} directives` +
                `${context.compressionApplied ? ' (compressed)' : ''}`,
            );

            const history = await this.memory.working.getMessages();
            const messages = this.promptBuilder.buildMessagesFromContext(
                userMessage,
                history,
                context,
            );
            const response = await llm.chat(messages);

            await this.memory.processInteraction(userMessage, response);
            await this.maybeReflect();

            // Phase 3: Record evaluation
            try {
                const memoryIds = context.memories.map((m) => m.memory.memory.id);
                await this.memory.evaluations.recordEvaluation(
                    uuid(),
                    userMessage,
                    memoryIds,
                    context.memories.length > 0,
                    context.memories.length > 0 ? 1.0 : 0.0,
                );
            } catch {
                // evaluation recording is best-effort
            }

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
     * Yields: { type: 'context' } → { type: 'token' }... → { type: 'done' }
     * Memory pipeline runs after the stream completes.
     */
    async *chatStream(userMessage: string): AsyncGenerator<
        | { type: 'context'; memoryCount: number; strategyCount: number; directiveCount: number; compressed: boolean }
        | { type: 'token'; content: string }
        | { type: 'done'; fullResponse: string }
    > {
        // 1. Build token-budgeted context
        const context = await this.contextBuilder.buildContext({
            query: userMessage,
            max_tokens: config.contextBuilder.defaultMaxTokens,
            priority: ['relevant', 'important', 'recent'],
            include_strategies: true,
            include_directives: true,
        });

        yield {
            type: 'context',
            memoryCount: context.memories.length,
            strategyCount: context.strategies.length,
            directiveCount: context.directives.length,
            compressed: context.compressionApplied,
        };

        // 2. Get history + build prompt
        const history = await this.memory.working.getMessages();
        const messages = this.promptBuilder.buildMessagesFromContext(
            userMessage,
            history,
            context,
        );

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

    /** Get the context builder for direct API access */
    getContextBuilder(): ContextBuilder {
        return this.contextBuilder;
    }

    /** Force a memory consolidation cycle */
    async consolidate(): Promise<void> {
        await this.memory.consolidation.consolidate();
    }

    /**
     * Record feedback on retrieved memories (Phase 2).
     * Call after each interaction with information about which memories were useful.
     */
    async recordFeedback(
        query: string,
        feedback: Array<{ memory_id: string; used: boolean; helpful: boolean }>,
    ): Promise<void> {
        await this.memory.recordFeedback(query, feedback);
    }
}
