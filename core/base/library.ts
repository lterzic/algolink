import type { BlockDecl } from "./block.js";

export type Library = Map<string, BlockDecl>;

// Currently only one global, replaced with loadable libraries
export const library: Library = new Map();

function validateBlockDecl(decl: BlockDecl): string[] {
    const errors: string[] = [];

    const checkIdent = (what: string, name: string) => {
        // Excludes '.', which the compiler uses to qualify names with node ids
        const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
        if (!IDENT.test(name))
            errors.push(`${decl.name}: invalid ${what} name "${name}"`);
    };

    checkIdent("block", decl.name);

    // Inputs and outputs share a scope in generated code
    const seen = new Set<string>();
    for (const ports of [decl.inputs, decl.outputs]) {
        for (const [pname, ptype] of Object.entries(ports)) {
            checkIdent("port", pname);
            checkIdent(ptype.k === "var" ? "type variable" : "type", ptype.name);
            if (seen.has(pname))
                errors.push(`${decl.name}: duplicate port "${pname}"`);
            seen.add(pname);
        }
    }

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

    return errors;
}

export function registerBlock(decl: BlockDecl, lib: Library = library) {
    const errors = validateBlockDecl(decl);
    if (lib.has(decl.name))
        errors.push(`${decl.name}: block already registered`);
    if (errors.length)
        throw new Error(errors.join("\n"));
    lib.set(decl.name, decl);
}
