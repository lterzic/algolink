import type { BlockLookup, Graph } from "../base/graph.js";
import { compileNested } from "../compiler/nested.js";
import { addBlock, type Library } from "./library.js";

// Compiles the graphs reachable from roots into nested blocks of lib, each after the graphs
// it uses, so graphs may refer to each other in any order. lib must be visible through reg,
// and blocks already in lib are kept as they are.
export function elaborate(lib: Library, graphs: Map<string, Graph>, reg: BlockLookup, roots: Iterable<string>) {
    const key = (name: string) => `${lib.name}/${name}`;
    const prefix = key("");
    const active: string[] = []; // Current path from a root

    const visit = (name: string) => {
        if (lib.blocks.has(name)) return;

        const i = active.indexOf(name);
        if (i >= 0)
            throw new Error(`Recursive block: ${[...active.slice(i), name].map(key).join(" -> ")}`);

        const g = graphs.get(name);
        if (!g) throw new Error(`${key(name)}: no such graph`);

        active.push(name);
        for (const node of g.nodes.values()) {
            const child = node.block.startsWith(prefix) ? node.block.slice(prefix.length) : undefined;
            if (child !== undefined && graphs.has(child)) visit(child);
        }
        try {
            addBlock(lib, compileNested(name, g, reg));
        } catch (e) {
            throw new Error(`${active.map(key).join(" -> ")}: ${(e as Error).message}`);
        }
        active.pop();
    };

    for (const r of roots) visit(r);
}
