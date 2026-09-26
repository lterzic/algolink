import type { TypeExpr } from "../src/base/block.js";
import type { Edge, Graph } from "../src/base/graph.js";

export const named = (name: string): TypeExpr => ({ k: "named", name });
export const tvar = (name: string): TypeExpr => ({ k: "var", name });

// Edges given as ["node.port", "node.port"]
export function graph(nodes: Record<string, string>, edges: [string, string][]): Graph {
    const toEdge = ([s, t]: [string, string]): Edge => {
        const [sourceNode, sourcePort] = s.split(".") as [string, string];
        const [targetNode, targetPort] = t.split(".") as [string, string];
        return { sourceNode, sourcePort, targetNode, targetPort };
    };
    return {
        nodes: new Map(Object.entries(nodes).map(([nid, block]) => [nid, { block }])),
        edges: edges.map(toEdge),
    };
}
