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
     * Process a user message and return the agent's response.
     * This is the main entry point for each interaction.
     */
    async chat(userMessage: string): Promise<string> {
        try {
            // 1. Retrieve relevant memories
            const memories = await this.memory.retrieve({ query: userMessage });
            console.log(`  🧠 Retrieved ${memories.length} memories (top score: ${memories[0]?.score.totalScore.toFixed(3) ?? 'N/A'})`);

            // 2. Get conversation history from working memory
            const history = await this.memory.working.getMessages();

            // 3. Build memory-augmented prompt
            const messages = this.promptBuilder.buildMessages(userMessage, history, memories);

            // 4. Send to LLM
            const response = await llm.chat(messages);

            // 5. Process through memory pipeline
            await this.memory.processInteraction(userMessage, response);

            // 6. Trigger reflection (on every 5th interaction)
            const stats = await this.memory.getStats();
            if (stats.interactions % 5 === 0) {
                const recentEpisodes = await this.memory.episodic.getRecent(5);
                const reflections = await this.reflection.reflectOnRecent(recentEpisodes);
                if (reflections.length > 0) {
                    console.log(`  💭 Generated ${reflections.length} reflection(s)`);
                }
            }

            return response;
        } catch (error) {
            console.error('Agent chat error:', error);

            // Store the error as an episodic memory
            await this.memory.episodic.store({
                eventType: 'error',
                sessionId: this.memory.working.getSessionId(),
                content: `Error processing: ${userMessage}. Error: ${error}`,
                result: 'failure',
                importance: 0.8,
                metadata: { error: String(error) },
            });

            return 'I encountered an error processing your request. I\'ve noted this so I can improve. Could you try rephrasing?';
        }
    }

    /** Get memory system statistics */
    async getStats(): Promise<Record<string, number>> {
        return this.memory.getStats();
    }

    /** Force a memory consolidation cycle */
    async consolidate(): Promise<void> {
        await this.memory.consolidation.consolidate();
    }
}
