import type { NestedBlock, PortList, TypeExpr } from "../base/block.js";
import type { Graph } from "../base/graph.js";
import type { Registry } from "../base/library.js";
import { IN_PORT, OUT_PORT } from "../base/block.js";
import { feedthroughDeps, schedule } from "./schedule.js";
import { resolveTypes } from "./typeres.js";
import { validateGraph } from "./validate.js";

// Derives a block interface from a graph whose core/In and core/Out nodes become its ports.
// The result is validated when added to a library
export function compileNested(name: string, g: Graph, reg: Registry): NestedBlock {
    validateGraph(g, reg);
    const deps = feedthroughDeps(g, reg);
    schedule(g, reg, deps); // Rejects algebraic loops
    const types = resolveTypes(g, reg);

    const portType = (nid: string, t: TypeExpr) =>
        t.k === "named" ? t : types.binds.get(nid)!.get(t.name)!;

    const inputs: PortList = {};
    const outputs: PortList = {};
    let stateful = false;
    for (const [nid, node] of g.nodes) {
        const b = reg.get(node.block)!;
        stateful ||= b.stateful;
        if (b.k === "in") inputs[nid] = portType(nid, b.outputs[OUT_PORT]!);
        if (b.k === "out") outputs[nid] = portType(nid, b.inputs[IN_PORT]!);
    }

    const feedthrough: Record<string, string[]> = {};
    for (const o of Object.keys(outputs))
        feedthrough[o] = [];
    for (const i of Object.keys(inputs)) {
        const seen = new Set([i]);
        const queue = [i];
        for (let k = 0; k < queue.length; k++) {
            for (const w of deps.get(queue[k]!)!) {
                if (seen.has(w)) continue;
                seen.add(w);
                queue.push(w);
                if (Object.hasOwn(feedthrough, w)) feedthrough[w]!.push(i);
            }
        }
    }

    return { k: "nested", name, vars: types.vars, inputs, outputs, stateful, feedthrough, graph: g };
}
