export type Lang = "c" | "cpp";

export type TypeExpr =
    | { k: "named"; name: string; }
    | { k: "var"; name: string; };

type PortList = Record<string, TypeExpr>;

export interface BlockDecl {
    name: string;
    inputs: PortList;
    outputs: PortList;
    // TODO: Add params
}
