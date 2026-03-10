import OpenAI from 'openai';
import { config } from '../config/index.js';

/**
 * LLM client using OpenAI-compatible API (works with LM Studio & OpenRouter).
 */
class LLMClient {
    private client: OpenAI;

    constructor() {
        this.client = new OpenAI({
            baseURL: config.llm.baseUrl,
            apiKey: config.llm.apiKey,
        });
    }

    /** Send a chat completion request */
    async chat(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        const response = await this.client.chat.completions.create({
            model: config.llm.model,
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048,
        });
        return response.choices[0]?.message?.content ?? '';
    }

    /** Generate a structured JSON response */
    async chatJSON<T = unknown>(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    ): Promise<T> {
        const response = await this.chat(
            [
                ...messages,
                {
                    role: 'system',
                    content: 'Respond ONLY with valid JSON. No markdown, no explanation, no code fences.',
                },
            ],
            { temperature: 0.3 },
        );

        // Strip potential markdown fences
        const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        return JSON.parse(cleaned) as T;
    }

    /** Generate embeddings for text (direct fetch — avoids SDK base64 encoding issue with LM Studio) */
    async embed(text: string): Promise<number[]> {
        const response = await fetch(`${config.llm.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.llm.apiKey}` },
            body: JSON.stringify({ model: config.llm.embeddingModel, input: text }),
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { data: Array<{ embedding: number[] }> };
        return data.data[0]!.embedding;
    }

    /** Generate embeddings for multiple texts */
    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${config.llm.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.llm.apiKey}` },
            body: JSON.stringify({ model: config.llm.embeddingModel, input: texts }),
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { data: Array<{ embedding: number[] }> };
        return data.data.map((d) => d.embedding);
    }
}

export const llm = new LLMClient();
