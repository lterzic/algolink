import {
    IN_PORT, isNamedType, OUT_PORT, TEMPLATE_REGEX, TEMPLATE_SEP,
    type BlockDecl, type IOBlock, type NativeBlock, type Template,
} from "./block.js";
import type { Edge, Graph } from "./graph.js";
import { checkIdent } from "./ident.js";
import { compileNested } from "../compiler/nested.js";

export interface Library {
    name: string;
    blocks: Map<string, BlockDecl>;
}

export const createLibrary = (name: string): Library => ({ name, blocks: new Map() });

function validateBlockDecl(decl: BlockDecl): string[] {
    const errors: string[] = [];

    checkIdent(errors, decl.name, "block", decl.name);

    for (const v of decl.vars)
        checkIdent(errors, decl.name, "type variable", v);
    if (new Set(decl.vars).size !== decl.vars.length)
        errors.push(`${decl.name}: duplicate type variables`);

    // Inputs and outputs share a scope in generated code
    const seen = new Set<string>();
    const used = new Set<string>();
    for (const ports of [decl.inputs, decl.outputs]) {
        for (const [pname, ptype] of Object.entries(ports)) {
            checkIdent(errors, decl.name, "port", pname);
            if (ptype.k === "var") {
                if (!decl.vars.includes(ptype.name))
                    errors.push(`${decl.name}: port "${pname}" uses undeclared type variable "${ptype.name}"`);
                used.add(ptype.name);
            } else if (!isNamedType(ptype.name))
                errors.push(`${decl.name}: unknown type "${ptype.name}"`);
            if (seen.has(pname))
                errors.push(`${decl.name}: duplicate port "${pname}"`);
            seen.add(pname);
        }
    }

    // Vars are only bound through ports, so an unused one could never be resolved
    for (const v of decl.vars)
        if (!used.has(v))
            errors.push(`${decl.name}: type variable "${v}" is not used by any port`);

    if (decl.feedthrough) {
        for (const [out, ins] of Object.entries(decl.feedthrough)) {
            if (!Object.hasOwn(decl.outputs, out))
                errors.push(`${decl.name}: feedthrough for unknown output "${out}"`);
            if (new Set(ins).size !== ins.length)
                errors.push(`${decl.name}: duplicate feedthrough inputs for output "${out}"`);
            for (const i of ins)
                if (!Object.hasOwn(decl.inputs, i))
                    errors.push(`${decl.name}: feedthrough of output "${out}" names unknown input "${i}"`);
        }

        // Without state, an unread input is ignored entirely
        if (!decl.stateful) {
            const read = new Set(Object.values(decl.feedthrough).flat());
            for (const i of Object.keys(decl.inputs))
                if (!read.has(i))
                    errors.push(`${decl.name}: stateless block never reads input "${i}"`);
        }
    }

    if (decl.k === "native")
        errors.push(...nativeErrors(decl));

    return errors;
}

function nativeErrors(decl: NativeBlock): string[] {
    const errors: string[] = [];
    const { vars } = decl;
    const ports = [...Object.keys(decl.inputs), ...Object.keys(decl.outputs)];

    // Ports, vars and self share the placeholder namespace
    for (const p of ports)
        if (vars.includes(p))
            errors.push(`${decl.name}: port "${p}" has the same name as a type variable`);
    if ([...ports, ...vars].includes("self"))
        errors.push(`${decl.name}: name "self" is reserved`);

    // Placeholders each template may use
    const self = ["self"];
    const scopes = {
        state: vars,
        init: [...vars, ...self],
        output: [...ports, ...vars, ...(decl.stateful ? self : [])],
        update: [...ports, ...vars, ...self],
    };

    // Missing languages are reported by the generator that needs them
    for (const [lang, impl] of Object.entries(decl.impl)) {
        const where = `${decl.name} (${lang})`;

        if (impl.output === undefined)
            errors.push(`${where}: missing output template`);
        if (decl.stateful && impl.state === undefined)
            errors.push(`${where}: stateful block needs a state type`);
        if (!decl.stateful)
            for (const f of ["state", "init", "update"] as const)
                if (impl[f] !== undefined)
                    errors.push(`${where}: stateless block can't have ${f}`);

        for (const [field, known] of Object.entries(scopes)) {
            const t = impl[field as keyof typeof scopes];
            if (t !== undefined)
                for (const e of templateErrors(t, vars, known))
                    errors.push(`${where} ${field}: ${e}`);
        }
    }

    return errors;
}

function templateErrors(t: Template, vars: string[], known: string[]): string[] {
    if (typeof t !== "string")
        return Object.entries(t).flatMap(([key, c]) => {
            const types = key.split(TEMPLATE_SEP);
            const errors = types.length !== vars.length
                ? [`case "${key}" doesn't match type variables [${vars}]`]
                : types.filter(n => !isNamedType(n)).map(n => `case "${key}" has unknown type "${n}"`);
            return [...errors, ...templateErrors(c, vars, known)];
        });

    return [...t.matchAll(TEMPLATE_REGEX)].flatMap(({ 0: tok, 1: ref, index }) => {
        if (ref === undefined)
            return [tok === "{" ? `unclosed "{" at offset ${index}` : `unmatched "}" at offset ${index}`];
        return known.includes(ref) ? [] : [`unknown placeholder "{${ref}}"`];
    });
}

export function addBlock(lib: Library, decl: BlockDecl) {
    const errors = validateBlockDecl(decl);
    if (lib.blocks.has(decl.name))
        errors.push(`${decl.name}: block already registered`);
    if (errors.length)
        throw new Error(errors.join("\n"));
    lib.blocks.set(decl.name, decl);
}

function coreLibrary(): Library {
    const T = { k: "var", name: "T" } as const;
    const lib = createLibrary("core");
    const blocks: IOBlock[] = [
        { k: "in", name: "In", vars: ["T"], inputs: {}, outputs: { [OUT_PORT]: T }, stateful: false },
        { k: "out", name: "Out", vars: ["T"], inputs: { [IN_PORT]: T }, outputs: {}, stateful: false },
    ];
    for (const b of blocks) addBlock(lib, b);
    return lib;
}

// Loaded libraries; blocks are looked up as "<library>/<block>"
export class Registry {
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

    get(key: string): BlockDecl | undefined {
        const i = key.indexOf("/");
        if (i < 0) return undefined;
        return this.libs.get(key.slice(0, i))?.blocks.get(key.slice(i + 1));
    }

    has(key: string): boolean {
        return this.get(key) !== undefined;
    }
}

// Nodes are a list, since object keys that look like integers lose insertion order
interface GraphJSON {
    nodes: { id: string; block: string; }[];
    edges: Edge[];
}

// Nested blocks keep only the graph; their interface is recompiled on load
type BlockJSON = NativeBlock | IOBlock | { k: "nested"; name: string; graph: GraphJSON; };

export interface LibraryJSON {
    version: 1;
    name: string;
    blocks: BlockJSON[];
}

const graphToJSON = (g: Graph): GraphJSON => ({
    nodes: [...g.nodes].map(([id, node]) => ({ id, block: node.block })),
    edges: g.edges,
});

const graphFromJSON = (json: GraphJSON): Graph => ({
    nodes: new Map(json.nodes.map(({ id, block }) => [id, { block }])),
    edges: json.edges,
});

// Blocks keep insertion order, which lets a nested block use earlier blocks of its own library
export function libraryToJSON(lib: Library): LibraryJSON {
    const blocks = [...lib.blocks.values()].map((b): BlockJSON =>
        b.k === "nested" ? { k: "nested", name: b.name, graph: graphToJSON(b.graph) } : b);
    return { version: 1, name: lib.name, blocks };
}

// Adds the library to reg, leaving reg unchanged if any block fails
export function libraryFromJSON(json: LibraryJSON, reg: Registry): Library {
    if (json.version !== 1)
        throw new Error(`${json.name}: unsupported library version ${json.version}`);

    const lib = createLibrary(json.name);
    reg.add(lib);
    try {
        for (const b of json.blocks)
            addBlock(lib, b.k === "nested" ? compileNested(b.name, graphFromJSON(b.graph), reg) : b);
    } catch (e) {
        reg.remove(lib.name);
        throw e;
    }
    return lib;
}
