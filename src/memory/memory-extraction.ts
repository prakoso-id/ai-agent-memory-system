import { llm } from '../llm/llm-client.js';
import type { ExtractionResult, ConversationMessage } from './types.js';

/**
 * Memory Extraction — uses the LLM to extract structured knowledge
 * from conversations (facts, entities, relationships).
 */
export class MemoryExtraction {
    /** Extract knowledge from a batch of conversation messages */
    async extract(messages: ConversationMessage[]): Promise<ExtractionResult> {
        const conversationText = messages
            .map((m) => `${m.role}: ${m.content}`)
            .join('\n');

        const prompt = `Analyze the following conversation and extract ALL structured knowledge.

CONVERSATION:
${conversationText}

Extract the following in JSON format:
{
  "facts": [
    { "content": "descriptive fact", "category": "user_identity|user_preference|project_fact|general_knowledge|technical_detail", "importance": 0.0-1.0 }
  ],
  "entities": [
    { "name": "entity name", "label": "User|Project|Technology|Organization|Concept", "properties": {} }
  ],
  "relationships": [
    { "source": "entity name", "target": "entity name", "relationship": "named|works_on|uses|prefers|knows|created|depends_on" }
  ]
}

CRITICAL RULES:
- ALWAYS extract user identity info (name, role, location, job) as "user_identity" category with importance 0.95
  Example: If user says "my name is John" → fact: "The user's name is John" (category: user_identity, importance: 0.95)
- ALWAYS extract user preferences (language, tools, frameworks) as "user_preference" with importance 0.9
- Extract project details as "project_fact" with importance 0.8
- Create entities for every named person, project, or technology mentioned
- Create relationships between entities (e.g., User "named" Jackson, User "prefers" TypeScript)
- If no meaningful knowledge exists, return empty arrays
- Be precise with entity names (normalize capitalization)`;

        try {
            const result = await llm.chatJSON<ExtractionResult>([
                { role: 'system', content: 'You are a knowledge extraction engine. Extract structured knowledge from conversations.' },
                { role: 'user', content: prompt },
            ]);

            // Validate structure
            return {
                facts: Array.isArray(result.facts) ? result.facts : [],
                entities: Array.isArray(result.entities) ? result.entities : [],
                relationships: Array.isArray(result.relationships) ? result.relationships : [],
            };
        } catch (error) {
            console.error('Memory extraction failed:', error);
            return { facts: [], entities: [], relationships: [] };
        }
    }

    /** Score the importance of a single memory/fact */
    async scoreImportance(content: string, context?: string): Promise<number> {
        try {
            const result = await llm.chatJSON<{ importance: number }>([
                {
                    role: 'system',
                    content: 'You are a memory importance scorer. Rate the importance of information on a scale of 0.0 to 1.0.',
                },
                {
                    role: 'user',
                    content: `Rate the importance of this information (0.0-1.0):
Content: "${content}"
${context ? `Context: "${context}"` : ''}

Respond as: { "importance": 0.XX }

Rating guide:
- 0.9-1.0: Critical user preference, key project decision, critical bug lesson
- 0.7-0.8: Important fact, useful technical detail
- 0.4-0.6: Moderately useful context
- 0.1-0.3: Low-value or ephemeral information`,
                },
            ]);
            return Math.max(0, Math.min(1, result.importance));
        } catch {
            return 0.5; // default
        }
    }
}
