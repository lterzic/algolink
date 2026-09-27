import { TEMPLATE_REGEX, TEMPLATE_SEP, type Lang, type Template, type TypeExpr } from "../base/block.js";
import type { Registry } from "../base/library.js";
import type { BlockLayout, StateMember } from "./layout.js";

// One emitted definition of a nested block. C monomorphizes, so it has one per concrete
// binding set; C++ and Rust emit one generic definition; Python ignores types
export interface Specialization {
    layout: BlockLayout;
    binds: Record<string, TypeExpr>;
}

export interface GeneratedSource {
    files: Map<string, string>;
}

/**
 * Target language backend.
 *
 * - Native children render their NativeImpl templates with renderTemplate. `{self}` expands to
 *   the member on the parent's state (`s->d`, `self.d`), and `{y}` to wherever the output
 *   convention puts that output (`out->y`, `out.y`, a local).
 * - The output convention is up to each generator: C takes `Out *out` for multi-output blocks,
 *   Rust `&mut Out`, C++ may return a struct, Python a tuple.
 * - Port and node names pass through ident() before they appear in output.
 * - core/In and core/Out nodes map to the parameters and outputs of the step functions.
 * - A C generator rejects unresolved generics on the top block.
 * - Types a native impl doesn't support fail when the generated code is compiled.
 */
export interface CodeGenerator {
    readonly lang: Lang;
    typeName(t: TypeExpr): string;
    ident(name: string): string; // Escapes target keywords

    // Struct in C/C++/Rust, class in Python
    stateTypeName(s: Specialization): string;
    emitStateType(s: Specialization, memberType: (m: StateMember) => string): string; // Empty if stateless
    emitOutputType(s: Specialization): string; // Empty if the output convention doesn't need one

    emitInit(s: Specialization): string; // Resets state in place, or constructs it
    emitOutput(s: Specialization): string; // Children in schedule.outputs order
    emitUpdate(s: Specialization): string; // Children in schedule.updates

    // Specializes `top` and every nested block it uses, and assembles them in dependency order
    generate(top: string, reg: Registry): GeneratedSource;
}

export interface RenderEnv {
    context: string; // Prefix for errors, e.g. "c implementation of std/Sqrt"
    vars: string[]; // Block's declared vars, which case keys follow
    ports: Record<string, string>; // Target expression for each port
    types: Record<string, TypeExpr>; // Binding for each var
    self?: string;
    typeName(t: TypeExpr): string;
}

// Lines are kept as written; indenting them is up to the generator
export function renderTemplate(t: Template, env: RenderEnv): string {
    if (typeof t !== "string") {
        const key = env.vars.map(v => {
            const bound = env.types[v]!;
            if (bound.k !== "named")
                throw new Error(`${env.context}: can't pick a case while ${v} is unresolved`);
            return bound.name;
        }).join(TEMPLATE_SEP);
        if (!Object.hasOwn(t, key))
            throw new Error(`${env.context}: no case for ${env.vars.join(TEMPLATE_SEP)} = ${key}`);
        return renderTemplate(t[key]!, env);
    }

    const lookup = (ref: string) => {
        if (Object.hasOwn(env.ports, ref)) return env.ports[ref]!;
        if (Object.hasOwn(env.types, ref)) return env.typeName(env.types[ref]!);
        if (ref === "self" && env.self !== undefined) return env.self;
        throw new Error(`${env.context}: nothing bound to "{${ref}}"`);
    };
    // Templates are validated on registration, so every match is a placeholder
    return t.replace(TEMPLATE_REGEX, (_, ref: string) => lookup(ref));
}
