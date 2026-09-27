import { test } from "node:test";
import assert from "node:assert/strict";
import type { NativeBlock, NativeImpl, Template, TypeExpr } from "../src/base/block.js";
import { addBlock, createLibrary } from "../src/base/library.js";
import { renderTemplate, type RenderEnv } from "../src/codegen/target.js";
import { named, tvar } from "./helpers.js";

const T = tvar("T");
const U = tvar("U");
const typeName = (t: TypeExpr) => t.k === "named" && t.name === "f32" ? "float" : t.name;

const env = (types: Record<string, TypeExpr>, self?: string): RenderEnv => ({
    context: "c implementation of t/X",
    vars: Object.keys(types),
    ports: { x: "in_x", y: "out->y" },
    types,
    ...(self === undefined ? {} : { self }),
    typeName,
});

const sqrt: Template = { f32: "{y} = sqrtf({x});", f64: "{y} = sqrt({x});" };

test("placeholders expand to ports, types and self", () => {
    assert.equal(renderTemplate("{y} = ({T}){self}.k * {x};", env({ T: named("f32") }, "s->g")),
        "out->y = (float)s->g.k * in_x;");
});

test("lines are kept as written", () => {
    assert.equal(renderTemplate("a = {x}\n    b = a", env({})), "a = in_x\n    b = a");
});

test("dispatch picks the case for the bound type", () => {
    assert.equal(renderTemplate(sqrt, env({ T: named("f32") })), "out->y = sqrtf(in_x);");
    assert.equal(renderTemplate(sqrt, env({ T: named("f64") })), "out->y = sqrt(in_x);");
});

test("dispatch on multiple vars follows vars order", () => {
    const cast: Template = { "f32,i16": "{y} = (int16_t){x};", "i16,f32": "{y} = (float){x};" };
    const types = { T: named("f32"), U: named("i16") };
    assert.equal(renderTemplate(cast, { ...env(types), vars: ["T", "U"] }), "out->y = (int16_t)in_x;");
    assert.equal(renderTemplate(cast, { ...env(types), vars: ["U", "T"] }), "out->y = (float)in_x;");
});

test("dispatch without a matching case", () => {
    assert.throws(() => renderTemplate(sqrt, env({ T: named("i32") })),
        { message: "c implementation of t/X: no case for T = i32" });
    assert.throws(() => renderTemplate(sqrt, env({ T: named("f32"), U: named("f32") })),
        { message: "c implementation of t/X: no case for T,U = f32,f32" });
});

test("dispatch on an unresolved var", () => {
    assert.throws(() => renderTemplate(sqrt, env({ T: tvar("T0") })),
        { message: "c implementation of t/X: can't pick a case while T is unresolved" });
});

test("unbound placeholder is a generator bug", () => {
    assert.throws(() => renderTemplate("{self}", env({})), { message: 'c implementation of t/X: nothing bound to "{self}"' });
});

test("native blocks are validated on registration", () => {
    const lib = createLibrary("t");
    const errors = (decl: NativeBlock) => {
        try {
            addBlock(lib, decl);
        } catch (e) {
            return (e as Error).message.split("\n");
        }
        assert.fail("expected registration to fail");
    };

    assert.deepEqual(errors({
        k: "native", name: "D", vars: ["T"], inputs: { u: T }, outputs: { y: T }, stateful: true,
        impl: { c: { output: "{y} = {self}.x;" }, cpp: { output: "{y}", state: "D<{u}>" } },
    }), [
        "D (c): stateful block needs a state type",
        'D (cpp) state: unknown placeholder "{u}"',
    ]);

    // Ports, vars and self share the placeholder namespace
    assert.deepEqual(errors({
        k: "native", name: "G", vars: ["T"], inputs: { self: T, T }, outputs: {}, stateful: false,
        impl: { c: { output: "", update: "{x}" } },
    }), [
        'G: port "T" has the same name as a type variable',
        'G: name "self" is reserved',
        "G (c): stateless block can't have update",
        'G (c) update: unknown placeholder "{x}"',
    ]);

    // Loaded libraries aren't type checked
    assert.deepEqual(errors({
        k: "native", name: "M", vars: ["T"], inputs: {}, outputs: { y: T }, stateful: false,
        impl: { c: {} as NativeImpl },
    }), ["M (c): missing output template"]);

    assert.deepEqual(errors({
        k: "native", name: "S", vars: ["T", "U"], inputs: { x: T }, outputs: { y: U }, stateful: false,
        impl: {
            c: { output: "{y} = {x} {z}; {{ }" },
            cpp: { output: { "f32,i16": "{y} = {w};", f32: "", "f32,f16": "" } },
        },
    }), [
        'S (c) output: unknown placeholder "{z}"',
        'S (c) output: unclosed "{" at offset 15',
        'S (c) output: unknown placeholder "{ }"',
        'S (cpp) output: unknown placeholder "{w}"',
        'S (cpp) output: case "f32" doesn\'t match type variables [T,U]',
        'S (cpp) output: case "f32,f16" has unknown type "f16"',
    ]);

    assert.deepEqual(errors({
        k: "native", name: "N", vars: [], inputs: {}, outputs: { y: named("f32") }, stateful: false,
        impl: { c: { output: { f32: "{y} = 1;" } } },
    }), ['N (c) output: case "f32" doesn\'t match type variables []']);

    assert.equal(lib.blocks.size, 0);
});
