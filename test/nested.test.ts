import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, createLibrary } from "../src/library/library.js";
import { compileNested } from "../src/compiler/nested.js";
import { createStdLibrary } from "../src/std/std.js";
import { graph, named, registry, tvar } from "./helpers.js";

const F = named("f32");
const I = named("i32");
const T = tvar("T");

function setup() {
    const reg = registry([
        { name: "F2F", vars: [], inputs: { u: F }, outputs: { y: F }, stateful: false },
        { name: "Gen", vars: ["T"], inputs: {}, outputs: { y: T }, stateful: false },
        { name: "ToInt", vars: ["T"], inputs: { u: T }, outputs: { y: I }, stateful: false },
    ]);
    reg.add(createStdLibrary());
    const user = createLibrary("u");
    reg.add(user);
    return { reg, user };
}

// y = x + previous y
const accum = () => graph({ x: "core/In", sum: "std/Add", d: "std/Delay", y: "core/Out" },
    [["x.y", "sum.a"], ["d.y", "sum.b"], ["sum.y", "d.u"], ["sum.y", "y.u"]]);

test("In and Out nodes become ports", () => {
    const { reg } = setup();
    const g = accum();
    assert.deepEqual(compileNested("Accum", g, reg), {
        k: "nested", name: "Accum", vars: ["T0"],
        inputs: { x: tvar("T0") }, outputs: { y: tvar("T0") },
        stateful: true, feedthrough: { y: ["x"] }, graph: g,
    });
});

test("concrete types reach the ports", () => {
    const { reg } = setup();
    const b = compileNested("Conv", graph({ x: "core/In", f: "F2F", t: "ToInt", y: "core/Out" },
        [["x.y", "f.u"], ["f.y", "t.u"], ["t.y", "y.u"]]), reg);
    assert.deepEqual([b.inputs, b.outputs, b.stateful], [{ x: F }, { y: I }, false]);
});

test("feedthrough follows only direct paths", () => {
    const { reg } = setup();
    const b = compileNested("Two", graph(
        { a: "core/In", b: "core/In", sum: "std/Add", d: "std/Delay", o1: "core/Out", o2: "core/Out" },
        [["a.y", "sum.a"], ["b.y", "sum.b"], ["sum.y", "o1.u"], ["a.y", "d.u"], ["d.y", "o2.u"]]), reg);
    assert.deepEqual(b.feedthrough, { o1: ["a", "b"], o2: [] });
    assert.deepEqual(Object.keys(b.inputs), ["a", "b"]);
});

test("generic not reachable from any port is rejected", () => {
    const { reg, user } = setup();
    const g = graph({ g: "Gen", t: "ToInt", y: "core/Out" }, [["g.y", "t.u"], ["t.y", "y.u"]]);
    assert.throws(() => addBlock(user, compileNested("Bad", g, reg)), { message: 'Bad: type variable "T0" is not used by any port' });
});

test("In and Out node ids must be identifiers", () => {
    const { reg, user } = setup();
    const g = graph({ "my x": "core/In", y: "core/Out" }, [["my x.y", "y.u"]]);
    assert.throws(() => addBlock(user, compileNested("Id", g, reg)), { message: 'Id: invalid port name "my x"' });
});

test("graph errors are reported before deriving the interface", () => {
    const { reg } = setup();
    const g = graph({ x: "core/In", s: "std/Add", y: "core/Out" }, [["x.y", "s.a"], ["s.y", "s.b"], ["s.y", "y.u"]]);
    assert.throws(() => compileNested("Loop", g, reg), /Algebraic loop: s -> s/);
});

test("nested blocks nest", () => {
    const { reg, user } = setup();
    addBlock(user, compileNested("Accum", accum(), reg));
    addBlock(user, compileNested("Hold", graph({ x: "core/In", d: "std/Delay", y: "core/Out" },
        [["x.y", "d.u"], ["d.y", "y.u"]]), reg));

    // Direct feedthrough of Accum carries through
    const outer = compileNested("Outer", graph({ x: "core/In", f: "F2F", a: "u/Accum", y: "core/Out" },
        [["x.y", "f.u"], ["f.y", "a.x"], ["a.y", "y.u"]]), reg);
    assert.deepEqual([outer.inputs, outer.stateful, outer.feedthrough], [{ x: F }, true, { y: ["x"] }]);

    // Hold has no feedthrough, so it breaks a loop like Delay does
    const loop = compileNested("Loop", graph({ x: "core/In", s: "std/Add", h: "u/Hold", y: "core/Out" },
        [["x.y", "s.a"], ["h.y", "s.b"], ["s.y", "h.x"], ["s.y", "y.u"]]), reg);
    assert.deepEqual(loop.feedthrough, { y: ["x"] });
});
