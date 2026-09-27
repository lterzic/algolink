import type { PortList, TypeExpr } from "../base/block.js";
import type { Registry } from "../base/library.js";
import { resolveTypes, type ResolvedTypes } from "../compiler/typeres.js";
import { feedthroughDeps, schedule, type GraphSchedule } from "../compiler/schedule.js";

export interface StateMember {
    node: string; // Member name
    block: string; // Qualified key of the stateful child
    binds: Record<string, TypeExpr>; // Child's vars in terms of the parent's vars
}

// Language independent shape of a nested block: a state type, ports and a schedule
export interface BlockLayout {
    key: string;
    vars: string[];
    inputs: PortList;
    outputs: PortList;
    state: StateMember[]; // Stateful children in node order, empty if stateless
    schedule: GraphSchedule;
    types: ResolvedTypes;
}

export function layoutBlock(key: string, reg: Registry): BlockLayout {
    const b = reg.get(key);
    if (b?.k !== "nested")
        throw new Error(`"${key}" is not a nested block`);

    const types = resolveTypes(b.graph, reg);
    const state: StateMember[] = [];
    for (const [nid, node] of b.graph.nodes)
        if (reg.get(node.block)!.stateful)
            state.push({ node: nid, block: node.block, binds: Object.fromEntries(types.binds.get(nid)!) });

    return {
        key,
        vars: b.vars,
        inputs: b.inputs,
        outputs: b.outputs,
        state,
        schedule: schedule(b.graph, reg, feedthroughDeps(b.graph, reg)),
        types,
    };
}
