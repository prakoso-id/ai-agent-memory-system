import * as readline from 'readline';
import { db } from './database/connections.js';
import { initializeDatabase } from './database/init.js';
import { AgentController } from './agent/agent-controller.js';

/**
 * AI Agent with Persistent Memory — Interactive CLI
 *
 * Commands:
 *   /stats    — show memory statistics
 *   /consolidate — force memory consolidation
 *   /clear    — clear working memory (conversation context)
 *   /quit     — exit
 */
async function main(): Promise<void> {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║   🧠  Self-Evolving AI Agent with Persistent Memory    ║');
    console.log('╚══════════════════════════════════════════════════════════╝\n');

    // Initialize databases + schemas
    await initializeDatabase();

    // Create agent
    const agent = new AgentController();
    console.log(`📌 Session: ${agent.getSessionId()}\n`);
    console.log('Type your message, or use /stats, /consolidate, /clear, /quit\n');

    // Interactive loop
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    const prompt = (): void => {
        rl.question('You > ', async (input) => {
            const trimmed = input.trim();
            if (!trimmed) { prompt(); return; }

            // Handle commands
            if (trimmed.startsWith('/')) {
                await handleCommand(trimmed, agent);
                prompt();
                return;
            }

            // Normal chat
            console.log('');
            process.stdout.write('Agent > ');
            const response = await agent.chat(trimmed);
            console.log(response);
            console.log('');

            prompt();
        });
    };

    prompt();

    // Graceful shutdown
    const shutdown = async () => {
        console.log('\n\n👋 Shutting down...');
        rl.close();
        await db.shutdown();
        process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
}

async function handleCommand(cmd: string, agent: AgentController): Promise<void> {
    switch (cmd) {
        case '/stats': {
            const stats = await agent.getStats();
            console.log('\n📊 Memory Statistics:');
            console.log(`  Episodic memories : ${stats.episodic}`);
            console.log(`  Semantic memories : ${stats.semantic}`);
            console.log(`  Reflections       : ${stats.reflections}`);
            console.log(`  Knowledge nodes   : ${stats.graphNodes}`);
            console.log(`  Interactions      : ${stats.interactions}`);
            console.log('');
            break;
        }
        case '/consolidate': {
            await agent.consolidate();
            console.log('');
            break;
        }
        case '/clear': {
            console.log('🗑️  Working memory cleared. Starting fresh conversation context.\n');
            break;
        }
        case '/quit':
        case '/exit': {
            console.log('\n👋 Shutting down...');
            await db.shutdown();
            process.exit(0);
        }
        case '/debug': {
            console.log('\n🔍 Debug: checking databases directly...\n');

            // Check PostgreSQL
            try {
                const pgResult = await db.pg.query(
                    'SELECT id, event_type, importance, LEFT(content, 80) as content_preview FROM episodic_memories ORDER BY created_at DESC LIMIT 5'
                );
                console.log(`📗 PostgreSQL episodic_memories: ${pgResult.rowCount} recent rows`);
                for (const row of pgResult.rows) {
                    console.log(`   [${row.event_type}] imp=${row.importance} "${row.content_preview}..."`);
                }
            } catch (err) {
                console.error('  ❌ PostgreSQL query failed:', err);
            }

            // Check Qdrant
            try {
                const qdrantInfo = await db.qdrant.getCollection('semantic_memory');
                console.log(`\n📘 Qdrant semantic_memory: ${qdrantInfo.points_count} points (dim=${(qdrantInfo.config?.params?.vectors as any)?.size})`);

                // Scroll to see actual stored points
                const scrollResult = await db.qdrant.scroll('semantic_memory', {
                    limit: 5,
                    with_payload: true,
                });
                for (const point of scrollResult.points) {
                    console.log(`   [${point.payload?.category}] imp=${point.payload?.importance} "${(point.payload?.content as string)?.substring(0, 80)}..."`);
                }
            } catch (err) {
                console.error('  ❌ Qdrant query failed:', err);
            }

            // Check Neo4j
            try {
                const neo4jSession = db.neo4j.session();
                const result = await neo4jSession.run('MATCH (e:Entity) RETURN e.name AS name, e.label AS label LIMIT 10');
                console.log(`\n📙 Neo4j entities: ${result.records.length} nodes`);
                for (const record of result.records) {
                    console.log(`   [${record.get('label')}] ${record.get('name')}`);
                }
                await neo4jSession.close();
            } catch (err) {
                console.error('  ❌ Neo4j query failed:', err);
            }

            // Check Redis
            try {
                const keys = await db.redis.keys('wm:*');
                console.log(`\n📕 Redis working memory keys: ${keys.length}`);
                for (const key of keys.slice(0, 5)) {
                    console.log(`   ${key}`);
                }
            } catch (err) {
                console.error('  ❌ Redis query failed:', err);
            }

            console.log('');
            break;
        }
        default:
            console.log(`Unknown command: ${cmd}. Available: /stats, /debug, /consolidate, /clear, /quit\n`);
    }
}

main().catch((err) => {
    console.error('💥 Fatal error:', err);
    process.exit(1);
});
