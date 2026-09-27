import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, type Registry } from "../src/base/library.js";
import { compileNested } from "../src/compiler/nested.js";
import { layoutBlock } from "../src/codegen/layout.js";
import { createStdLibrary } from "../src/std/std.js";
import { graph, named, registry, tvar } from "./helpers.js";

const F = named("f32");
const T = tvar("T");

function setup(): Registry {
    const reg = registry([{ name: "F2F", vars: [], inputs: { u: F }, outputs: { y: F }, stateful: false }]);
    reg.add(createStdLibrary());
    const lib = reg.library("t")!;
    addBlock(lib, {
        k: "native", name: "Sq", vars: ["T"], inputs: { x: T }, outputs: { y: T }, stateful: false,
        impl: { cpp: { output: "{y} = {x} * {x};" } },
    });

    const add = (name: string, nodes: Record<string, string>, edges: [string, string][]) =>
        addBlock(lib, compileNested(name, graph(nodes, edges), reg));
    add("Accum", { x: "core/In", sum: "std/Add", d: "std/Delay", y: "core/Out" },
        [["x.y", "sum.a"], ["d.y", "sum.b"], ["sum.y", "d.u"], ["sum.y", "y.u"]]);
    add("Quad", { x: "core/In", a: "Sq", b: "Sq", y: "core/Out" }, [["x.y", "a.x"], ["a.y", "b.x"], ["b.y", "y.u"]]);
    add("QuadF", { x: "core/In", f: "F2F", q: "Quad", y: "core/Out" }, [["x.y", "f.u"], ["f.y", "q.x"], ["q.y", "y.u"]]);
    add("QuadG", { x: "core/In", q: "Quad", y: "core/Out" }, [["x.y", "q.x"], ["q.y", "y.u"]]);
    add("Outer", { x: "core/In", w: "core/In", f: "F2F", a: "Accum", g: "Accum", y: "core/Out", z: "core/Out" },
        [["x.y", "f.u"], ["f.y", "a.x"], ["a.y", "y.u"], ["w.y", "g.x"], ["g.y", "z.u"]]);
    return reg;
}

test("state holds stateful children only", () => {
    const l = layoutBlock("t/Accum", setup());
    assert.deepEqual(l.state, [{ node: "d", block: "std/Delay", binds: { T: tvar("T0") } }]);
    assert.deepEqual(l.vars, ["T0"]);
    assert.deepEqual(l.schedule, { outputs: ["x", "d", "sum", "y"], updates: ["d"] });
});

test("stateless block has no state", () => {
    assert.deepEqual(layoutBlock("t/Quad", setup()).state, []);
});

test("nested child binds are in the parent's terms", () => {
    const l = layoutBlock("t/Outer", setup());
    assert.deepEqual(l.state, [
        { node: "a", block: "t/Accum", binds: { T0: F } },
        { node: "g", block: "t/Accum", binds: { T0: tvar("T0") } },
    ]);
    assert.deepEqual([l.vars, l.inputs, l.outputs], [["T0"], { x: F, w: tvar("T0") }, { y: F, z: tvar("T0") }]);
});

test("only nested blocks have a layout", () => {
    assert.throws(() => layoutBlock("std/Add", setup()), { message: '"std/Add" is not a nested block' });
});
