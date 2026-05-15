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

    /** Send a chat completion request with automatic retry (up to 3 attempts, exponential backoff) */
    async chat(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        options?: { temperature?: number; maxTokens?: number },
    ): Promise<string> {
        return this.withRetry(() => this.chatOnce(messages, options));
    }

    /** Single attempt — used by chat() and wrapped with retry logic */
    private async chatOnce(
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

    /**
     * Retry helper with exponential backoff.
     * Does NOT retry on AbortError (timeout) — retrying a timed-out request would triple latency.
     */
    private async withRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
        let lastError: unknown;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                return await fn();
            } catch (err) {
                lastError = err;
                // Do not retry timeouts or auth errors
                if (err instanceof Error && (err.name === 'AbortError' || String(err).includes('401') || String(err).includes('403'))) {
                    throw err;
                }
                if (attempt < maxAttempts) {
                    const delayMs = 200 * Math.pow(2, attempt - 1); // 200ms, 400ms
                    await new Promise(r => setTimeout(r, delayMs));
                }
            }
        }
        throw lastError;
    }

    /** Stream a chat completion response token-by-token (BUG-003: includes timeout abort) */
    async *chatStream(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
        options?: { temperature?: number; maxTokens?: number },
    ): AsyncGenerator<string> {
        const controller = new AbortController();
        const timer = setTimeout(
            () => controller.abort(new Error(`LLM stream timed out after ${LLMClient.LLM_TIMEOUT_MS}ms`)),
            LLMClient.LLM_TIMEOUT_MS,
        );
        try {
            const stream = await this.client.chat.completions.create(
                {
                    model: config.llm.model,
                    messages,
                    temperature: options?.temperature ?? 0.7,
                    max_tokens: options?.maxTokens ?? 2048,
                    stream: true,
                },
                { signal: controller.signal },
            );

            for await (const chunk of stream) {
                const content = chunk.choices[0]?.delta?.content;
                if (content) yield content;
            }
        } finally {
            clearTimeout(timer);
        }
    }

    /** Generate a structured JSON response with retry on parse failure (BUG-007) */
    async chatJSON<T = unknown>(
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    ): Promise<T> {
        const withJsonInstruction = [
            ...messages,
            {
                role: 'system' as const,
                content: 'Respond ONLY with valid JSON. No markdown, no explanation, no code fences.',
            },
        ];

        for (let attempt = 1; attempt <= 2; attempt++) {
            const response = await this.chat(withJsonInstruction, { temperature: 0.3 });
            const cleaned = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            try {
                return JSON.parse(cleaned) as T;
            } catch {
                if (attempt === 2) throw new SyntaxError(`LLM returned invalid JSON after 2 attempts: ${cleaned.substring(0, 200)}`);
                // Retry with a stricter prompt
                withJsonInstruction.push(
                    { role: 'assistant' as const, content: response },
                    { role: 'user' as const, content: 'Your response was not valid JSON. Reply with ONLY a raw JSON object, no markdown.' },
                );
            }
        }
        // unreachable
        throw new SyntaxError('chatJSON: unexpected exit');
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
