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
