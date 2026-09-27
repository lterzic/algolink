import { IN_PORT, OUT_PORT, type BlockDecl, type IOBlock } from "../base/block.js";
import type { BlockLookup } from "../base/graph.js";
import { checkIdent } from "../base/ident.js";
import { addBlock, createLibrary, type Library } from "./library.js";

export const CORE = "core";

function coreLibrary(): Library {
    const T = { k: "var", name: "T" } as const;
    const lib = createLibrary(CORE);
    const blocks: IOBlock[] = [
        { k: "in", name: "In", vars: ["T"], inputs: {}, outputs: { [OUT_PORT]: T }, stateful: false },
        { k: "out", name: "Out", vars: ["T"], inputs: { [IN_PORT]: T }, outputs: {}, stateful: false },
    ];
    for (const b of blocks) addBlock(lib, b);
    return lib;
}

// Loaded libraries; blocks are looked up as "<library>/<block>"
export class Registry implements BlockLookup {
    private libs = new Map<string, Library>();

    constructor() {
        this.add(coreLibrary());
    }

    // Kept by reference, so blocks added to lib later are visible
    add(lib: Library) {
        const errors: string[] = [];
        checkIdent(errors, lib.name, "library", lib.name);
        if (this.libs.has(lib.name))
            errors.push(`${lib.name}: library already loaded`);
        if (errors.length)
            throw new Error(errors.join("\n"));
        this.libs.set(lib.name, lib);
    }

    remove(name: string) {
        this.libs.delete(name);
    }

    library(name: string): Library | undefined {
        return this.libs.get(name);
    }

    // Names of loaded libraries in load order, starting with core
    names(): string[] {
        return [...this.libs.keys()];
    }

    get(key: string): BlockDecl | undefined {
        const i = key.indexOf("/");
        if (i < 0) return undefined;
        return this.libs.get(key.slice(0, i))?.blocks.get(key.slice(i + 1));
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }
}
