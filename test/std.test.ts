import { test } from "node:test";
import assert from "node:assert/strict";
import type { Lang, NamedType, NativeImpl, TypeExpr } from "../src/base/block.js";
import { Registry } from "../src/base/library.js";
import { renderTemplate } from "../src/codegen/target.js";
import { createStdLibrary } from "../src/std/std.js";
import { named } from "./helpers.js";

const C_TYPES: Partial<Record<NamedType, string>> = { f32: "float", f64: "double", i32: "int32_t" };
const typeName = (t: TypeExpr) => t.k === "named" ? C_TYPES[t.name] ?? t.name : t.name;

const std = createStdLibrary();

function render(block: string, lang: Lang, field: keyof NativeImpl, T: NamedType) {
    const b = std.blocks.get(block)!;
    assert.equal(b.k, "native");
    const t = b.k === "native" ? b.impl[lang]![field] : undefined;
    return renderTemplate(t!, {
        context: `${lang} implementation of std/${block}`,
        vars: b.vars,
        ports: { x: "x", y: "y", u: "u", a: "a", b: "b" },
        types: { T: named(T) },
        self: "s->d",
        typeName,
    });
}

test("std registers", () => {
    assert.doesNotThrow(() => new Registry().add(createStdLibrary()));
});

test("Sqrt picks the C function by type", () => {
    assert.equal(render("Sqrt", "c", "output", "f32"), "y = sqrtf(x);");
    assert.equal(render("Sqrt", "c", "output", "f64"), "y = sqrt(x);");
    assert.throws(() => render("Sqrt", "c", "output", "i32"), { message: "c implementation of std/Sqrt: no case for T = i32" });
    assert.equal(render("Sqrt", "cpp", "output", "i32"), "y = std::sqrt(x);");
});

test("Abs uses a generic expression for signed ints in C", () => {
    assert.equal(render("Abs", "c", "output", "f32"), "y = fabsf(x);");
    assert.equal(render("Abs", "c", "output", "i32"), "y = x < 0 ? -x : x;");
    assert.throws(() => render("Abs", "c", "output", "u8"), { message: "c implementation of std/Abs: no case for T = u8" });
});

test("Delay state and calls", () => {
    assert.equal(render("Delay", "c", "state", "f64"), "al_delay_f64");
    assert.equal(render("Delay", "c", "update", "f64"), "s->d.x = u;");
    assert.equal(render("Delay", "cpp", "state", "f32"), "algolink::Delay<float>");
    assert.equal(render("Delay", "cpp", "output", "f32"), "y = s->d.value();");
});
