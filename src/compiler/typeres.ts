import type { TypeExpr } from "../base/block.js";
import { edgeName, type Graph } from "../base/graph.js";
import type { Registry } from "../base/library.js";

export interface ResolvedTypes {
    vars: string[]; // Graph generics if vars ambiguous
    binds: Map<string, Map<string, TypeExpr>>; // Resolutins for all vars in each node
}

// Expects a graph that passed validateGraph
export function resolveTypes(g: Graph, reg: Registry): ResolvedTypes {
    const r: Resolution = new Map();

    const mangle = (nid: string, t: TypeExpr): TypeExpr => (
        t.k === "named" ? t : { k: "var", name: `${nid}.${t.name}` }
    );

    for (const e of g.edges) {
        const sourceBlock = reg.get(g.nodes.get(e.sourceNode)!.block)!;
        const targetBlock = reg.get(g.nodes.get(e.targetNode)!.block)!;

        const a = mangle(e.sourceNode, sourceBlock.outputs[e.sourcePort]!);
        const b = mangle(e.targetNode, targetBlock.inputs[e.targetPort]!);

        if (!unifyTypes(a, b, r))
            throw new Error(`Can't match types on edge ${edgeName(e)}: ${walk(a, r).name} !== ${walk(b, r).name}`);
    }

    const result: ResolvedTypes = {
        vars: [],
        binds: new Map()
    };

    // For any var type that wasn't resolved to a concerete type, create
    // graph level generic variables
    let countFresh = 0;
    const resolveVars = (t: TypeExpr) => {
        t = walk(t, r);
        if (t.k === "var" && !result.vars.includes(t.name)) {
            const tr: TypeExpr = { k: "var", name: `T${countFresh++}` };
            r.set(t.name, tr);
            result.vars.push(tr.name);
            t = tr;
        }
        return t;
    };

    for (const [nid, node] of g.nodes) {
        const binds: Map<string, TypeExpr> = new Map();
        for (const v of reg.get(node.block)!.vars)
            binds.set(v, resolveVars(mangle(nid, { k: "var", name: v })));
        result.binds.set(nid, binds);
    }

    return result;
}

// Map "var" type expressions to resolved types, or to
// other "var" types with which they are equal.
type Resolution = Map<string, TypeExpr>;

// TODO: Improve efficiency by updating the entries to point
// to tree root during walk
function walk(t: TypeExpr, r: Resolution) {
    while (t.k === "var") {
        const parent = r.get(t.name);
        if (!parent) break;
        t = parent;
    }
    return t;
}

function unifyTypes(a: TypeExpr, b: TypeExpr, r: Resolution) {
    a = walk(a, r);
    b = walk(b, r);

    if (a.k === "var" && b.k === "var" && a.name === b.name) return true;
    if (a.k === "var") { r.set(a.name, b); return true; }
    if (b.k === "var") { r.set(b.name, a); return true; }

    // If neither type expression is a variable, they must be the same type
    return a.name === b.name;
}
