import type { BlockDecl } from "./block.js";

export interface Node {
    block: string; // Library lookup key
    ui?: unknown; // Editor data (position, color, ...), preserved but never read by the compiler
}

// Finds the block of a node by its "<library>/<block>" key, implemented by Registry
export interface BlockLookup {
    get(key: string): BlockDecl | undefined;
}

export interface Edge {
    sourceNode: string;
    sourcePort: string;
    targetNode: string;
    targetPort: string;
}

export const edgeName = (e: Edge) => `${e.sourceNode}.${e.sourcePort} -> ${e.targetNode}.${e.targetPort}`;

export interface Graph {
    nodes: Map<string, Node>;
    edges: Edge[];
    ui?: unknown;
}
