import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { DashboardGraph, DashboardGraphNode, DashboardGraphEdge } from '../lib/api.js';

interface GraphViewProps {
    graph: DashboardGraph;
    width?: number;
    height?: number;
    onNodeClick?: (node: DashboardGraphNode) => void;
}

const ROLE_COLORS: Record<string, string> = {
    coder:    '#7c6af7',
    pm:       '#34d399',
    qa:       '#fbbf24',
    analyst:  '#f87171',
    general:  '#60a5fa',
    default:  '#94a3b8',
};

/**
 * GraphView — D3 force-directed graph visualisation of the Neo4j knowledge graph.
 *
 * Node colour encodes primary role (first in roles[]) or grey if unassigned.
 * Node radius encodes importance (0–1 scaled to 6–20px).
 * Edge opacity encodes relationship weight.
 * Hover tooltip shows: name, label, confidence, usage count.
 */
export function GraphView({ graph, width = 800, height = 600, onNodeClick }: GraphViewProps) {
    const svgRef = useRef<SVGSVGElement>(null);

    useEffect(() => {
        const svg = d3.select(svgRef.current!);
        svg.selectAll('*').remove();

        if (graph.nodes.length === 0) return;

        // Build D3 node/link structure
        type D3Node = DashboardGraphNode & d3.SimulationNodeDatum;
        type D3Link = { source: string; target: string; edge: DashboardGraphEdge } & d3.SimulationLinkDatum<D3Node>;

        const nodes: D3Node[] = graph.nodes.map((n) => ({ ...n }));
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));

        const links: D3Link[] = graph.edges
            .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
            .map((e) => ({ source: e.source, target: e.target, edge: e }));

        // Simulation
        const sim = d3.forceSimulation<D3Node>(nodes)
            .force('link',   d3.forceLink<D3Node, D3Link>(links).id((d) => d.id).distance(80))
            .force('charge', d3.forceManyBody().strength(-200))
            .force('center', d3.forceCenter(width / 2, height / 2))
            .force('collide', d3.forceCollide(24));

        const g = svg.append('g');

        // Zoom / pan
        svg.call(
            d3.zoom<SVGSVGElement, unknown>()
                .scaleExtent([0.2, 4])
                .on('zoom', (event) => g.attr('transform', event.transform)),
        );

        // Edges
        const link = g.append('g').selectAll('line').data(links).join('line')
            .attr('stroke', '#2d3148')
            .attr('stroke-width', (d) => Math.max(1, d.edge.weight * 2))
            .attr('stroke-opacity', 0.7);

        // Edge labels
        const linkLabel = g.append('g').selectAll('text').data(links).join('text')
            .attr('fill', '#6b7280')
            .attr('font-size', 9)
            .attr('text-anchor', 'middle')
            .text((d) => d.edge.relationship);

        // Nodes
        const radius = (d: D3Node) => 6 + d.importance * 14;

        const node = g.append('g').selectAll('circle').data(nodes).join('circle')
            .attr('r', radius)
            .attr('fill', (d) => ROLE_COLORS[d.roles?.[0] ?? 'default'] ?? ROLE_COLORS.default)
            .attr('fill-opacity', (d) => 0.4 + (d.confidence ?? 0.5) * 0.6)
            .attr('stroke', (d) => ROLE_COLORS[d.roles?.[0] ?? 'default'] ?? ROLE_COLORS.default)
            .attr('stroke-width', 2)
            .attr('cursor', 'pointer')
            .on('click', (_, d) => onNodeClick?.(d))
            .call(
                d3.drag<SVGCircleElement, D3Node>()
                    .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
                    .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
                    .on('end',   (event, d) => { if (!event.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }) as any,
            );

        // Node labels
        const label = g.append('g').selectAll('text').data(nodes).join('text')
            .attr('fill', '#e2e8f0')
            .attr('font-size', 11)
            .attr('text-anchor', 'middle')
            .attr('dy', (d) => -radius(d) - 4)
            .text((d) => d.name.length > 16 ? d.name.substring(0, 14) + '…' : d.name);

        // Tooltip (title element)
        node.append('title').text((d) =>
            `${d.name} [${d.label}]\nImportance: ${d.importance.toFixed(2)}\n` +
            `Confidence: ${(d.confidence ?? 0).toFixed(2)}\nUsage: ${d.usageCount}\n` +
            `Roles: ${d.roles?.join(', ') || 'all'}`,
        );

        // Tick
        sim.on('tick', () => {
            link
                .attr('x1', (d) => (d.source as D3Node).x!)
                .attr('y1', (d) => (d.source as D3Node).y!)
                .attr('x2', (d) => (d.target as D3Node).x!)
                .attr('y2', (d) => (d.target as D3Node).y!);

            linkLabel
                .attr('x', (d) => ((d.source as D3Node).x! + (d.target as D3Node).x!) / 2)
                .attr('y', (d) => ((d.source as D3Node).y! + (d.target as D3Node).y!) / 2);

            node.attr('cx', (d) => d.x!).attr('cy', (d) => d.y!);
            label.attr('x', (d) => d.x!).attr('y', (d) => d.y!);
        });

        return () => { sim.stop(); };
    }, [graph, width, height, onNodeClick]);

    if (graph.nodes.length === 0) {
        return (
            <div style={styles.empty}>
                No graph data. Try a different search query or start an agent session.
            </div>
        );
    }

    return (
        <svg
            ref={svgRef}
            width="100%"
            height={height}
            style={{ background: 'var(--surface)', borderRadius: 8, border: '1px solid var(--border)' }}
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="xMidYMid meet"
        />
    );
}

const styles: Record<string, React.CSSProperties> = {
    empty: {
        height: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--muted)',
        fontSize: 14,
        border: '1px dashed var(--border)',
        borderRadius: 8,
    },
};
