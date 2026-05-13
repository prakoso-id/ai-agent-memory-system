import type { TaskType } from '../types.js';

/**
 * Task-type relevance scoring.
 *
 * Each task type is associated with a keyword set.
 * A memory's `tags` are compared against those keywords to produce a
 * relevance score (0.0–1.0) that is folded into the final retrieval ranking.
 *
 * This decouples retrieval intent from semantic similarity, so e.g.
 * a memory tagged ['typescript', 'bug'] surfaces higher during a coding task
 * even if its raw vector distance is moderate.
 */

const TASK_KEYWORDS: Record<TaskType, readonly string[]> = {
    coding: [
        'code', 'coding', 'function', 'bug', 'typescript', 'javascript', 'python', 'rust', 'go',
        'implementation', 'algorithm', 'api', 'class', 'method', 'variable', 'syntax',
        'error', 'debug', 'test', 'library', 'framework', 'module', 'package', 'compile',
        'refactor', 'lint', 'type', 'interface', 'async', 'promise', 'callback',
    ],
    chat: [
        'conversation', 'question', 'answer', 'preference', 'user_identity', 'name',
        'location', 'interest', 'opinion', 'feeling', 'chat', 'greeting', 'message',
        'request', 'clarify', 'explain',
    ],
    planning: [
        'plan', 'strategy', 'architecture', 'design', 'goal', 'requirement', 'milestone',
        'roadmap', 'feature', 'task', 'priority', 'decision', 'tradeoff', 'scope',
        'timeline', 'sprint', 'backlog', 'stakeholder',
    ],
    analysis: [
        'analysis', 'data', 'metric', 'insight', 'pattern', 'trend', 'observation',
        'finding', 'evaluation', 'review', 'comparison', 'benchmark', 'report',
        'statistics', 'correlation', 'performance',
    ],
    dnd: [
        'character', 'quest', 'dungeon', 'dragon', 'spell', 'combat', 'armor', 'weapon',
        'inventory', 'npc', 'location', 'lore', 'monster', 'level', 'experience', 'gold',
        'game_event', 'world_state', 'hypothesis', 'prediction', 'plot_hook', 'style_guide',
        'canonized_history', 'campaign', 'tavern', 'potion', 'magic', 'hp', 'adventure',
    ],
    general: [],   // no affinity — contributes neutral score
};

/**
 * Scores how relevant a memory's tags are to a given task type.
 *
 * - `general` always returns 0.5 (neutral, no bias).
 * - A memory with no tags returns a low baseline (0.3) regardless of task type.
 * - Fully matching tags saturate at 1.0.
 */
export function scoreTaskRelevance(tags: string[], taskType: TaskType): number {
    if (taskType === 'general') return 0.5;

    const keywords = TASK_KEYWORDS[taskType];
    // Defensive guard: unknown task types treated as neutral
    if (!keywords || tags.length === 0 || keywords.length === 0) return 0.3;

    const normalizedTags = tags.map((t) => t.toLowerCase());
    const matches = normalizedTags.filter(
        (tag) => keywords.some((kw) => tag.includes(kw) || kw.includes(tag)),
    );

    // Base 0.3 + up to 0.7 from tag overlap ratio
    return Math.min(1.0, 0.3 + (matches.length / Math.max(tags.length, 1)) * 0.7);
}

/**
 * Infer a `TaskType` from a free-form task description string.
 * Falls back to `'chat'` when no signals are detected.
 */
export function inferTaskType(task: string): TaskType {
    const lower = task.toLowerCase();

    const score = (signals: readonly string[]) =>
        signals.filter((s) => lower.includes(s)).length;

    const scores: [TaskType, number][] = [
        ['coding',   score(TASK_KEYWORDS.coding)],
        ['planning', score(TASK_KEYWORDS.planning)],
        ['analysis', score(TASK_KEYWORDS.analysis)],
        ['chat',     score(TASK_KEYWORDS.chat)],
    ];

    scores.sort((a, b) => b[1] - a[1]);
    return scores[0]![1] > 0 ? scores[0]![0] : 'chat';
}
