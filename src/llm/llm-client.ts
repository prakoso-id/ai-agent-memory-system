import OpenAI from 'openai';
import { config } from '../config/index.js';

/**
 * LLM client using OpenAI-compatible API (works with LM Studio & OpenRouter).
 */
class LLMClient {
    private client: OpenAI;

    // 20-second timeout: LLM requests that hang will throw instead of blocking forever.
    // Must be shorter than any test timeout (TC-011 uses 30s) so the catch block runs.
    private static readonly LLM_TIMEOUT_MS = 20_000;

    constructor() {
        this.client = new OpenAI({
            baseURL: config.llm.baseUrl,
            apiKey: config.llm.apiKey,
            timeout: LLMClient.LLM_TIMEOUT_MS,
        });
    }

    /** Send a chat completion request */
    async chat(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        // Use AbortController + native setTimeout for a guaranteed per-request timeout.
        // This is more reliable than the SDK constructor-level timeout, which doesn't
        // abort hanging TCP connections in all runtimes (e.g. Bun).
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(new Error(`LLM chat timed out after ${LLMClient.LLM_TIMEOUT_MS}ms`)),
            LLMClient.LLM_TIMEOUT_MS,
        );
        try {
            const response = await this.client.chat.completions.create(
                {
                    model: config.llm.model,
                    messages,
                    temperature: options?.temperature ?? 0.7,
                    max_tokens: options?.maxTokens ?? 2048,
                },
                { signal: controller.signal },
            );
            return response.choices[0]?.message?.content ?? '';
        } finally {
            clearTimeout(timer);
        }
    }

    /** Stream a chat completion response token-by-token */
    async *chatStream(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        options?: { temperature?: number; maxTokens?: number },
    ): AsyncGenerator<string> {
        const stream = await this.client.chat.completions.create({
            model: config.llm.model,
            messages,
            temperature: options?.temperature ?? 0.7,
            max_tokens: options?.maxTokens ?? 2048,
            stream: true,
        });

        for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) yield content;
        }
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
        const response = await fetch(`${config.embedding.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.embedding.apiKey}` },
            body: JSON.stringify({ model: config.embedding.model, input: text }),
            signal: AbortSignal.timeout(LLMClient.LLM_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { data: Array<{ embedding: number[] }> };
        return data.data[0]!.embedding;
    }

    /** Generate embeddings for multiple texts */
    async embedBatch(texts: string[]): Promise<number[][]> {
        const response = await fetch(`${config.embedding.baseUrl}/embeddings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.embedding.apiKey}` },
            body: JSON.stringify({ model: config.embedding.model, input: texts }),
            signal: AbortSignal.timeout(LLMClient.LLM_TIMEOUT_MS),
        });

        if (!response.ok) {
            throw new Error(`Embedding API error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json() as { data: Array<{ embedding: number[] }> };
        return data.data.map((d) => d.embedding);
    }
}

export const llm = new LLMClient();
