import type { Graph } from "./graph.js";

const LANGS = ["c", "cpp"] as const;
export type Lang = typeof LANGS[number];

// Allowed port types, each language maps to their own native type
const NAMED_TYPES = [
    "f32", "f64",
    "i8", "i16", "i32", "i64",
    "u8", "u16", "u32", "u64",
    "bool",
] as const;
export type NamedType = typeof NAMED_TYPES[number];

export type TypeExpr =
    | { k: "named"; name: NamedType; }
    | { k: "var"; name: string; };

export type PortList = Record<string, TypeExpr>;

// A template is a string which uses "{x}" placeholders, where these
// placeholders are replaced with port variables or generic arguments.
// Special "{self}" should be used to access state. Literal braces aren't
// supported, so a lone "{" or "}" is an error.
export const TEMPLATE_REGEX = /\{([^{}]*)\}|[{}]/g;
export const TEMPLATE_SEP = ",";
// Either a single string used for any generic arguments, or a dictionary
// of strings (templates) for each argument combination where combinations
// are joined by a separator in vars order (e.g. T=f32, U=i16 -> "f32,i16")
export type Template = string | Record<string, string>;

export interface NativeImpl {
    output: Template; // Writes outputs, may read feedthrough inputs
    import?: string; // Raw top of file line, e.g. "#include <math.h>"
    state?: Template; // State type, required iff stateful
    init?: Template;
    update?: Template;
}

// Everything the compiler passes need to know about a block
interface BlockBase {
    name: string;
    vars: string[]; // Type variables, ports may only use these
    inputs: PortList;
    outputs: PortList;
    stateful: boolean;
    feedthrough?: Record<string, string[]>; // Inputs each output reads directly, all if omitted
    // TODO: Add params
}

export interface NativeBlock extends BlockBase {
    k: "native";
    impl: Partial<Record<Lang, NativeImpl>>;
}

// Interface is derived from the graph by compileNested
export interface NestedBlock extends BlockBase {
    k: "nested";
    graph: Graph;
}

// core/In and core/Out, which become the ports of a nested block
export interface IOBlock extends BlockBase {
    k: "in" | "out";
}

export type BlockDecl = NativeBlock | NestedBlock | IOBlock;

// Port names of core/In and core/Out
export const IN_PORT = "u";
export const OUT_PORT = "y";

// Loaded libraries aren't type checked, so names still need a runtime check
export const isNamedType = (name: string): name is NamedType =>
    (NAMED_TYPES as readonly string[]).includes(name);
