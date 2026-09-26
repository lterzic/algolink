export interface Node {
    block: string; // Library lookup key
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
}
