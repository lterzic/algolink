import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockDecl } from "../src/base/block.js";
import { registerBlock } from "../src/base/library.js";
import { resolveTypes, type ResolvedTypes } from "../src/compiler/typeres.js";
import { graph, named, tvar } from "./helpers.js";

const F = named("float");
const I = named("int");
const T = tvar("T");

// resolveTypes only reads the global library; each test file runs in its own process
const blocks: BlockDecl[] = [
    { name: "FSrc", inputs: {}, outputs: { y: F }, stateful: false },
    { name: "ISrc", inputs: {}, outputs: { y: I }, stateful: false },
    { name: "Gen", inputs: {}, outputs: { y: T }, stateful: false },
    { name: "FSink", inputs: { u: F }, outputs: {}, stateful: false },
    { name: "ISink", inputs: { u: I }, outputs: {}, stateful: false },
    { name: "Id", inputs: { u: T }, outputs: { y: T }, stateful: false },
    { name: "Add", inputs: { a: T, b: T }, outputs: { y: T }, stateful: false },
    { name: "Delay", inputs: { u: T }, outputs: { y: T }, stateful: true, feedthrough: { y: [] } },
    { name: "ToInt", inputs: { u: T }, outputs: { y: I }, stateful: false },
    { name: "Pair", inputs: { a: tvar("A"), b: tvar("B") }, outputs: { x: tvar("A"), y: tvar("B") }, stateful: false },
];
for (const b of blocks) registerBlock(b);

const binds = (r: ResolvedTypes) =>
    Object.fromEntries([...r.binds].map(([nid, m]) => [nid, Object.fromEntries(m)]));

test("concrete type propagates downstream", () => {
    const g = graph({ s: "FSrc", a: "Id", b: "Id" }, [["s.y", "a.u"], ["a.y", "b.u"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, []);
    assert.deepEqual(binds(r), { s: {}, a: { T: F }, b: { T: F } });
});

test("concrete type propagates upstream", () => {
    const g = graph({ g: "Gen", a: "Id", k: "FSink" }, [["g.y", "a.u"], ["a.y", "k.u"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, []);
    assert.deepEqual(binds(r), { g: { T: F }, a: { T: F }, k: {} });
});

test("type propagates across a join", () => {
    const g = graph({ g: "Gen", s: "FSrc", add: "Add" }, [["g.y", "add.a"], ["s.y", "add.b"]]);
    assert.deepEqual(binds(resolveTypes(g)), { g: { T: F }, s: {}, add: { T: F } });
});

test("same var name in different nodes is independent", () => {
    const g = graph({ s: "FSrc", i: "ISrc", a: "Id", b: "Id" }, [["s.y", "a.u"], ["i.y", "b.u"]]);
    assert.deepEqual(binds(resolveTypes(g)), { s: {}, i: {}, a: { T: F }, b: { T: I } });
});

test("different vars in one block are independent", () => {
    const g = graph({ s: "FSrc", i: "ISrc", p: "Pair" }, [["s.y", "p.a"], ["i.y", "p.b"]]);
    assert.deepEqual(binds(resolveTypes(g)).p, { A: F, B: I });
});

test("unresolved var becomes a graph generic", () => {
    const g = graph({ g: "Gen", a: "Id" }, [["g.y", "a.u"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, ["T0"]);
    assert.deepEqual(binds(r), { g: { T: tvar("T0") }, a: { T: tvar("T0") } });
});

test("unconnected components get separate generics", () => {
    const g = graph({ g1: "Gen", a: "Id", g2: "Gen", b: "Id" }, [["g1.y", "a.u"], ["g2.y", "b.u"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, ["T0", "T1"]);
    assert.deepEqual(binds(r), {
        g1: { T: tvar("T0") }, a: { T: tvar("T0") },
        g2: { T: tvar("T1") }, b: { T: tvar("T1") },
    });
});

test("partially resolved block", () => {
    const g = graph({ s: "FSrc", g: "Gen", p: "Pair" }, [["s.y", "p.a"], ["g.y", "p.b"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, ["T0"]);
    assert.deepEqual(binds(r).p, { A: F, B: tvar("T0") });
});

test("var on input only stays generic", () => {
    // ToInt fixes its output, which says nothing about its input
    const g = graph({ g: "Gen", t: "ToInt", a: "Id" }, [["g.y", "t.u"], ["t.y", "a.u"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, ["T0"]);
    assert.deepEqual(binds(r), { g: { T: tvar("T0") }, t: { T: tvar("T0") }, a: { T: I } });
});

test("loop through delay resolves", () => {
    const g = graph({ s: "FSrc", add: "Add", d: "Delay" },
        [["s.y", "add.a"], ["add.y", "d.u"], ["d.y", "add.b"]]);
    assert.deepEqual(binds(resolveTypes(g)), { s: {}, add: { T: F }, d: { T: F } });
});

test("loop without a concrete type is one generic", () => {
    // The closing edge unifies a var with itself
    const g = graph({ add: "Add", d: "Delay", g: "Gen" },
        [["g.y", "add.a"], ["add.y", "d.u"], ["d.y", "add.b"]]);
    const r = resolveTypes(g);
    assert.deepEqual(r.vars, ["T0"]);
    assert.deepEqual(binds(r), { add: { T: tvar("T0") }, d: { T: tvar("T0") }, g: { T: tvar("T0") } });
});

test("graph without edges", () => {
    const r = resolveTypes(graph({ s: "FSrc", g: "Gen" }, []));
    assert.deepEqual(r.vars, ["T0"]);
    assert.deepEqual(binds(r), { s: {}, g: { T: tvar("T0") } });
});

test("mismatch between concrete ports", () => {
    const g = graph({ s: "FSrc", k: "ISink" }, [["s.y", "k.u"]]);
    assert.throws(() => resolveTypes(g), { message: "Can't match types on edge s.y -> k.u: float !== int" });
});

test("mismatch at a join", () => {
    const g = graph({ s: "FSrc", i: "ISrc", add: "Add" }, [["s.y", "add.a"], ["i.y", "add.b"]]);
    assert.throws(() => resolveTypes(g), { message: "Can't match types on edge i.y -> add.b: int !== float" });
});

test("mismatch reports resolved types, not vars", () => {
    const g = graph({ s: "FSrc", a: "Id", b: "Id", k: "ISink" },
        [["s.y", "a.u"], ["a.y", "b.u"], ["b.y", "k.u"]]);
    assert.throws(() => resolveTypes(g), { message: "Can't match types on edge b.y -> k.u: float !== int" });
});

test("mismatch found after vars are linked", () => {
    // a and b are linked through add before either gets a concrete type
    const g = graph({ a: "Id", b: "Id", add: "Add", s: "FSrc", i: "ISrc" },
        [["a.y", "add.a"], ["b.y", "add.b"], ["s.y", "a.u"], ["i.y", "b.u"]]);
    assert.throws(() => resolveTypes(g), { message: "Can't match types on edge i.y -> b.u: int !== float" });
});

test("generic numbering restarts per call", () => {
    const g = graph({ g: "Gen" }, []);
    resolveTypes(g);
    assert.deepEqual(resolveTypes(g).vars, ["T0"]);
});
