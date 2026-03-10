import { v4 as uuid } from 'uuid';
import { db } from '../database/connections.js';
import type { KnowledgeNode, KnowledgeEdge } from './types.js';

/**
 * Knowledge Graph Memory — Neo4j-backed relationship store.
 * Stores structured entity relationships for reasoning.
 */
export class KnowledgeGraphService {
    /** Add or update a node */
    async addNode(node: Omit<KnowledgeNode, 'id' | 'createdAt' | 'updatedAt'>): Promise<KnowledgeNode> {
        const id = uuid();
        const now = new Date().toISOString();
        const session = db.neo4j.session();

        try {
            await session.run(
                `MERGE (e:Entity { name: $name, label: $label })
         ON CREATE SET e.id = $id,
                       e.properties = $properties,
                       e.createdAt = $now,
                       e.updatedAt = $now
         ON MATCH SET  e.properties = $properties,
                       e.updatedAt = $now`,
                {
                    id,
                    name: node.name,
                    label: node.label,
                    properties: JSON.stringify(node.properties ?? {}),
                    now,
                },
            );

            return { ...node, id, createdAt: now, updatedAt: now };
        } finally {
            await session.close();
        }
    }

    /** Add a relationship between two entities */
    async addEdge(edge: Omit<KnowledgeEdge, 'id' | 'createdAt'>): Promise<KnowledgeEdge> {
        const id = uuid();
        const now = new Date().toISOString();
        const session = db.neo4j.session();

        try {
            await session.run(
                `MATCH (source:Entity { name: $sourceName })
         MATCH (target:Entity { name: $targetName })
         MERGE (source)-[r:RELATES_TO { relationship: $relationship }]->(target)
         ON CREATE SET r.id = $id,
                       r.properties = $properties,
                       r.weight = $weight,
                       r.createdAt = $now
         ON MATCH SET  r.properties = $properties,
                       r.weight = $weight`,
                {
                    id,
                    sourceName: edge.sourceId,    // using name-based matching
                    targetName: edge.targetId,
                    relationship: edge.relationship,
                    properties: JSON.stringify(edge.properties ?? {}),
                    weight: edge.weight,
                    now,
                },
            );

            return { ...edge, id, createdAt: now };
        } finally {
            await session.close();
        }
    }

    /** Get all relationships for an entity */
    async getRelated(entityName: string): Promise<Array<{ node: KnowledgeNode; edge: KnowledgeEdge; direction: 'outgoing' | 'incoming' }>> {
        const session = db.neo4j.session();

        try {
            const result = await session.run(
                `MATCH (e:Entity { name: $name })-[r:RELATES_TO]-(other:Entity)
         RETURN e, r, other,
                CASE WHEN startNode(r) = e THEN 'outgoing' ELSE 'incoming' END AS direction`,
                { name: entityName },
            );

            return result.records.map((record) => {
                const other = record.get('other').properties;
                const rel = record.get('r').properties;
                return {
                    node: {
                        id: other.id,
                        name: other.name,
                        label: other.label,
                        properties: JSON.parse(other.properties || '{}'),
                        createdAt: other.createdAt,
                        updatedAt: other.updatedAt,
                    } as KnowledgeNode,
                    edge: {
                        id: rel.id,
                        sourceId: rel.sourceName,
                        targetId: rel.targetName,
                        relationship: rel.relationship,
                        properties: JSON.parse(rel.properties || '{}'),
                        weight: rel.weight?.toNumber?.() ?? rel.weight ?? 1,
                        createdAt: rel.createdAt,
                    } as KnowledgeEdge,
                    direction: record.get('direction') as 'outgoing' | 'incoming',
                };
            });
        } finally {
            await session.close();
        }
    }

    /** Full-text query over the knowledge graph */
    async query(queryText: string): Promise<KnowledgeNode[]> {
        const session = db.neo4j.session();
        try {
            const result = await session.run(
                `MATCH (e:Entity)
         WHERE toLower(e.name) CONTAINS toLower($query)
            OR toLower(e.label) CONTAINS toLower($query)
         RETURN e
         LIMIT 20`,
                { query: queryText },
            );

            return result.records.map((record) => {
                const props = record.get('e').properties;
                return {
                    id: props.id,
                    name: props.name,
                    label: props.label,
                    properties: JSON.parse(props.properties || '{}'),
                    createdAt: props.createdAt,
                    updatedAt: props.updatedAt,
                } as KnowledgeNode;
            });
        } finally {
            await session.close();
        }
    }

    /** Find the shortest path between two entities */
    async getPath(fromName: string, toName: string): Promise<Array<{ node: string; relationship?: string }>> {
        const session = db.neo4j.session();
        try {
            const result = await session.run(
                `MATCH path = shortestPath(
           (a:Entity { name: $from })-[*..6]-(b:Entity { name: $to })
         )
         RETURN nodes(path) AS nodes, relationships(path) AS rels`,
                { from: fromName, to: toName },
            );

            if (result.records.length === 0) return [];

            const nodes = result.records[0]!.get('nodes') as Array<{ properties: { name: string } }>;
            const rels = result.records[0]!.get('rels') as Array<{ properties: { relationship: string } }>;

            const path: Array<{ node: string; relationship?: string }> = [];
            for (let i = 0; i < nodes.length; i++) {
                path.push({
                    node: nodes[i]!.properties.name,
                    relationship: rels[i]?.properties.relationship,
                });
            }
            return path;
        } finally {
            await session.close();
        }
    }

    /** Get total node count */
    async nodeCount(): Promise<number> {
        const session = db.neo4j.session();
        try {
            const result = await session.run(`MATCH (e:Entity) RETURN count(e) AS total`);
            return result.records[0]?.get('total').toNumber() ?? 0;
        } finally {
            await session.close();
        }
    }
}
