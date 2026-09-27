import type { NamedType, NativeBlock, TypeExpr } from "../src/base/block.js";
import type { Edge, Graph } from "../src/base/graph.js";
import { addBlock, createLibrary, Registry } from "../src/base/library.js";

export const named = (name: NamedType): TypeExpr => ({ k: "named", name });
export const tvar = (name: string): TypeExpr => ({ k: "var", name });

export type StubDecl = Omit<NativeBlock, "k" | "impl">;

// Smallest valid native block, for tests that don't render code
export const stub = (d: StubDecl): NativeBlock =>
    ({ ...d, k: "native", impl: { c: d.stateful ? { output: "", state: "S" } : { output: "" } } });

// Blocks go into library "t", which graph() assumes for unqualified block names
export function registry(blocks: StubDecl[]): Registry {
    const reg = new Registry();
    const lib = createLibrary("t");
    reg.add(lib);
    for (const b of blocks) addBlock(lib, stub(b));
    return reg;
}

// Edges given as ["node.port", "node.port"]
export function graph(nodes: Record<string, string>, edges: [string, string][]): Graph {
    const toEdge = ([s, t]: [string, string]): Edge => {
        const [sourceNode, sourcePort] = s.split(".") as [string, string];
        const [targetNode, targetPort] = t.split(".") as [string, string];
        return { sourceNode, sourcePort, targetNode, targetPort };
    };
    const qualify = (block: string) => block.includes("/") ? block : `t/${block}`;
    return {
        nodes: new Map(Object.entries(nodes).map(([nid, block]) => [nid, { block: qualify(block) }])),
        edges: edges.map(toEdge),
    };
}
