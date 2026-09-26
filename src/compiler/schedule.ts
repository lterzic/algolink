import type { BlockDecl } from "../base/block.js";
import type { Graph } from "../base/graph.js";
import { library, type Library } from "../base/library.js";

export interface GraphSchedule {
    outputs: string[]; // Node ids in output computation order
    updates: string[]; // Stateful node ids, updated after all outputs in any order
}

function isFeedthrough(b: BlockDecl, input: string) {
    return !b.feedthrough || Object.values(b.feedthrough).some(ins => ins.includes(input));
}

// Expects a graph that passed validateGraph
export function schedule(g: Graph, lib: Library = library): GraphSchedule {
    // For each node, specify all nodes that depend on it (source -> target)
    const deps = new Map<string, Set<string>>();
    const indeg = new Map<string, number>();
    for (const nid of g.nodes.keys()) {
        deps.set(nid, new Set());
        indeg.set(nid, 0);
    }

    for (const e of g.edges) {
        const target = lib.get(g.nodes.get(e.targetNode)!.block)!;
        if (!isFeedthrough(target, e.targetPort)) continue;
        const next = deps.get(e.sourceNode)!;
        if (next.has(e.targetNode)) continue;
        next.add(e.targetNode);
        indeg.set(e.targetNode, indeg.get(e.targetNode)! + 1);
    }

    // Seeded in insertion order for stable output
    const queue = [...g.nodes.keys()].filter(nid => indeg.get(nid) === 0);
    for (let i = 0; i < queue.length; i++) {
        for (const w of deps.get(queue[i]!)!) {
            const d = indeg.get(w)! - 1;
            indeg.set(w, d);
            if (d === 0) queue.push(w);
        }
    }

    if (queue.length < g.nodes.size) {
        const stuck = [...g.nodes.keys()].filter(nid => indeg.get(nid)! > 0);
        // Every stuck node waits on a stuck node, so walking back must repeat a node on a loop
        const path: string[] = [];
        let v = stuck[0]!;
        while (!path.includes(v)) {
            path.push(v);
            v = stuck.find(u => deps.get(u)!.has(v))!;
        }
        const loop = path.slice(path.indexOf(v)).reverse();
        throw new Error(`Algebraic loop: ${[...loop, loop[0]].join(" -> ")} ` +
            `(break it with a stateful block without feedthrough, e.g. Delay)`);
    }

    const updates = [...g.nodes]
        .filter(([, node]) => lib.get(node.block)!.stateful)
        .map(([nid]) => nid);

    return { outputs: queue, updates };
}
