import { edgeName, type BlockLookup, type Edge, type Graph } from "../base/graph.js";

// Checks everything later passes assume, so they can index the graph and registry directly
export function validateGraph(g: Graph, reg: BlockLookup): void {
    const errors: string[] = [];

    for (const [nid, node] of g.nodes)
        if (!reg.get(node.block))
            errors.push(`Node "${nid}": unknown block "${node.block}"`);

    const checkPort = (e: Edge, nid: string, dir: "inputs" | "outputs", port: string) => {
        const node = g.nodes.get(nid);
        if (!node) {
            errors.push(`Edge ${edgeName(e)}: unknown node "${nid}"`);
            return false;
        }
        // Unknown block is already reported for the node
        const block = reg.get(node.block);
        if (!block) return false;

        // Port lists are plain objects, so plain indexing would also find Object.prototype keys
        if (!Object.hasOwn(block[dir], port)) {
            errors.push(`Edge ${edgeName(e)}: block "${node.block}" has no ${dir.slice(0, -1)} "${port}"`);
            return false;
        }
        return true;
    };

    // Number of edges driving each "<nodeId>.<input>"
    const drivers = new Map<string, number>();
    for (const e of g.edges) {
        const sourceOk = checkPort(e, e.sourceNode, "outputs", e.sourcePort);
        const targetOk = checkPort(e, e.targetNode, "inputs", e.targetPort);
        if (!sourceOk || !targetOk) continue;

        const key = `${e.targetNode}.${e.targetPort}`;
        drivers.set(key, (drivers.get(key) ?? 0) + 1);
    }

    for (const [nid, node] of g.nodes) {
        const block = reg.get(node.block);
        if (!block) continue;

        for (const input of Object.keys(block.inputs)) {
            const n = drivers.get(`${nid}.${input}`) ?? 0;
            if (n === 0) errors.push(`Node "${nid}": input "${input}" is not connected`);
            if (n > 1) errors.push(`Node "${nid}": input "${input}" has ${n} incoming edges`);
        }
    }

    if (errors.length)
        throw new Error(errors.join("\n"));
}
