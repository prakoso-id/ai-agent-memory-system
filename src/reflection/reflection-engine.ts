import { llm } from '../llm/llm-client.js';
import { ReflectionMemoryService } from '../memory/reflection-memory.js';
import { KnowledgeGraphService } from '../memory/knowledge-graph.js';
import type { EpisodicMemory, ReflectionMemory } from '../memory/types.js';

/**
 * Reflection Engine — post-task analysis.
 * Generates structured reflections: observation, root cause, lesson, strategy.
 */
export class ReflectionEngine {
    constructor(
        private reflectionMemory: ReflectionMemoryService,
        private knowledgeGraph: KnowledgeGraphService,
    ) { }

    /**
     * Analyze a completed task and generate a reflection.
     * Called after task completion (especially on failure or partial success).
     */
    async reflect(episode: EpisodicMemory): Promise<ReflectionMemory | null> {
        // Only reflect on task executions and non-trivial conversations
        if (episode.eventType === 'system') return null;

        try {
            const reflection = await llm.chatJSON<{
                observation: string;
                rootCause: string;
                lessonLearned: string;
                strategyImprovement: string;
                shouldRemember: boolean;
            }>([
                {
                    role: 'system',
                    content: `You are a self-reflection engine for an AI agent. Analyze the agent's interaction and extract actionable lessons.

Your goal is to help the agent improve over time by identifying patterns, mistakes, and successful strategies.`,
                },
                {
                    role: 'user',
                    content: `Analyze this interaction and generate a reflection:

Event type: ${episode.eventType}
Task: ${episode.task ?? 'general conversation'}
Result: ${episode.result ?? 'completed'}
Content: ${episode.content}

Respond as JSON:
{
  "observation": "What happened in this interaction",
  "rootCause": "Why did it succeed/fail, or what was the key dynamic",
  "lessonLearned": "What the agent should remember for the future",
  "strategyImprovement": "How the agent should approach similar situations next time",
  "shouldRemember": true/false (is this reflection worth persisting?)
}`,
                },
            ]);

            if (!reflection.shouldRemember) return null;

            // Store the reflection
            const stored = await this.reflectionMemory.store({
                content: `Reflection on: ${episode.task ?? episode.eventType}`,
                observation: reflection.observation,
                rootCause: reflection.rootCause,
                lessonLearned: reflection.lessonLearned,
                strategyImprovement: reflection.strategyImprovement,
                relatedEpisodeIds: [episode.id],
                importance: episode.result === 'failure' ? 0.9 : 0.6,
                metadata: {
                    episodeEventType: episode.eventType,
                    episodeResult: episode.result,
                },
            });

            // Update knowledge graph with the lesson
            await this.knowledgeGraph.addNode({
                name: `Lesson: ${reflection.lessonLearned.substring(0, 60)}`,
                label: 'Lesson',
                properties: {
                    observation: reflection.observation,
                    strategy: reflection.strategyImprovement,
                },
            });

            return stored;
        } catch (error) {
            console.error('Reflection failed:', error);
            return null;
        }
    }

    /** Run periodic reflection on recent episodes */
    async reflectOnRecent(
        recentEpisodes: EpisodicMemory[],
        batchSize = 5,
    ): Promise<ReflectionMemory[]> {
        const reflections: ReflectionMemory[] = [];

        // Focus on failures and important interactions
        const worthReflecting = recentEpisodes
            .filter((e) => e.result === 'failure' || e.importance >= 0.7)
            .slice(0, batchSize);

        for (const episode of worthReflecting) {
            const reflection = await this.reflect(episode);
            if (reflection) reflections.push(reflection);
        }

        return reflections;
    }
}
