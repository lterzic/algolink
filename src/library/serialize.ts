import type { IOBlock, NativeBlock } from "../base/block.js";
import type { Edge, Graph } from "../base/graph.js";
import { elaborate } from "./elaborate.js";
import { addBlock, createLibrary, type Library } from "./library.js";
import type { Registry } from "./registry.js";

// Nodes are a list, since object keys that look like integers lose insertion order
export interface GraphJSON {
    nodes: { id: string; block: string; ui?: unknown; }[];
    edges: Edge[];
    ui?: unknown;
}

// Nested blocks keep only the graph; their interface is recompiled on load
type BlockJSON = NativeBlock | IOBlock | { k: "nested"; name: string; graph: GraphJSON; };

export interface LibraryJSON {
    version: 1;
    name: string;
    blocks: BlockJSON[];
}

// ui is left out when absent, so loading and saving doesn't add keys
export const graphToJSON = (g: Graph): GraphJSON => ({
    nodes: [...g.nodes].map(([id, node]) => ({ id, block: node.block, ...(node.ui !== undefined && { ui: node.ui }) })),
    edges: g.edges,
    ...(g.ui !== undefined && { ui: g.ui }),
});

export const graphFromJSON = (json: GraphJSON): Graph => ({
    nodes: new Map(json.nodes.map(({ id, block, ui }) => [id, { block, ...(ui !== undefined && { ui }) }])),
    edges: json.edges,
    ...(json.ui !== undefined && { ui: json.ui }),
});

export function libraryToJSON(lib: Library): LibraryJSON {
    const blocks = [...lib.blocks.values()].map((b): BlockJSON =>
        b.k === "nested" ? { k: "nested", name: b.name, graph: graphToJSON(b.graph) } : b);
    return { version: 1, name: lib.name, blocks };
}

// Adds the library to reg, leaving reg unchanged if any block fails.
// Nested blocks may use each other in any order
export function libraryFromJSON(json: LibraryJSON, reg: Registry): Library {
    if (json.version !== 1)
        throw new Error(`${json.name}: unsupported library version ${json.version}`);

    const lib = createLibrary(json.name);
    reg.add(lib);
    try {
        const graphs = new Map<string, Graph>();
        for (const b of json.blocks) {
            if (b.k !== "nested")
                addBlock(lib, b);
            else if (graphs.has(b.name))
                throw new Error(`${b.name}: block already registered`);
            else
                graphs.set(b.name, graphFromJSON(b.graph));
        }
        for (const name of graphs.keys())
            if (lib.blocks.has(name))
                throw new Error(`${name}: block already registered`);
        elaborate(lib, graphs, reg, graphs.keys());
    } catch (e) {
        reg.remove(lib.name);
        throw e;
    }
    return lib;
}
