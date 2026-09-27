import type { NativeBlock, TypeExpr } from "../base/block.js";
import { addBlock, createLibrary, type Library } from "../base/library.js";

const T: TypeExpr = { k: "var", name: "T" };

function binary(name: string, op: string): NativeBlock {
    const output = `{y} = {a} ${op} {b};`;
    return {
        k: "native", name, vars: ["T"], inputs: { a: T, b: T }, outputs: { y: T }, stateful: false,
        impl: { c: { output }, cpp: { output } },
    };
}

// State types come from runtime headers that ship with the generators (not written yet)
export function createStdLibrary(): Library {
    const lib = createLibrary("std");
    const blocks: NativeBlock[] = [
        binary("Add", "+"),
        binary("Sub", "-"),
        binary("Mul", "*"),
        binary("Div", "/"),
        {
            k: "native", name: "Neg", vars: ["T"], inputs: { x: T }, outputs: { y: T }, stateful: false,
            impl: { c: { output: "{y} = -{x};" }, cpp: { output: "{y} = -{x};" } },
        },
        {
            k: "native", name: "Abs", vars: ["T"], inputs: { x: T }, outputs: { y: T }, stateful: false,
            impl: {
                c: {
                    import: "#include <math.h>",
                    output: {
                        f32: "{y} = fabsf({x});",
                        f64: "{y} = fabs({x});",
                        ...Object.fromEntries(["i8", "i16", "i32", "i64"].map(t => [t, "{y} = {x} < 0 ? -{x} : {x};"])),
                    },
                },
                cpp: { import: "#include <cmath>", output: "{y} = std::abs({x});" },
            },
        },
        {
            k: "native", name: "Sqrt", vars: ["T"], inputs: { x: T }, outputs: { y: T }, stateful: false,
            impl: {
                c: {
                    import: "#include <math.h>",
                    output: { f32: "{y} = sqrtf({x});", f64: "{y} = sqrt({x});" },
                },
                cpp: { import: "#include <cmath>", output: "{y} = std::sqrt({x});" },
            },
        },
        {
            k: "native", name: "Delay", vars: ["T"], inputs: { u: T }, outputs: { y: T }, stateful: true,
            feedthrough: { y: [] },
            impl: {
                c: {
                    import: "#include \"algolink/delay.h\"",
                    state: { f32: "al_delay_f32", f64: "al_delay_f64", i32: "al_delay_i32", i64: "al_delay_i64" },
                    init: "{self}.x = 0;",
                    output: "{y} = {self}.x;",
                    update: "{self}.x = {u};",
                },
                cpp: {
                    import: "#include \"algolink/delay.hpp\"",
                    state: "algolink::Delay<{T}>",
                    init: "{self}.reset();",
                    output: "{y} = {self}.value();",
                    update: "{self}.push({u});",
                },
            },
        },
    ];
    for (const b of blocks) addBlock(lib, b);
    return lib;
}
