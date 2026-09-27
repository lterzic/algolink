import { test } from "node:test";
import assert from "node:assert/strict";
import type { NativeBlock, TypeExpr } from "../src/base/block.js";
import type { Graph } from "../src/base/graph.js";
import { addBlock, createLibrary } from "../src/library/library.js";
import { validateGraph as validate } from "../src/compiler/validate.js";
import { graph, named, registry, stub, tvar } from "./helpers.js";

const F = named("f32");

const reg = registry([
    { name: "Source", vars: [], inputs: {}, outputs: { y: F }, stateful: false },
    { name: "Gain", vars: [], inputs: { u: F }, outputs: { y: F }, stateful: false },
    { name: "Add", vars: [], inputs: { a: F, b: F }, outputs: { y: F }, stateful: false },
]);
const validateGraph = (g: Graph) => validate(g, reg);

// Errors are reported together, one per line
function errors(fn: () => void): string[] {
    try {
        fn();
    } catch (e) {
        return (e as Error).message.split("\n");
    }
    assert.fail("expected validation to fail");
}

test("valid graph passes", () => {
    const g = graph({ s: "Source", k: "Gain", add: "Add" },
        [["s.y", "k.u"], ["s.y", "add.a"], ["k.y", "add.b"]]);
    assert.doesNotThrow(() => validateGraph(g));
});

test("empty graph passes", () => {
    assert.doesNotThrow(() => validateGraph(graph({}, [])));
});

test("unknown block is reported once", () => {
    // Edges touching the node aren't checked further, so the only error is the block itself
    const g = graph({ s: "Source", x: "Nope" }, [["s.y", "x.u"], ["x.y", "x.v"]]);
    assert.deepEqual(errors(() => validateGraph(g)), ['Node "x": unknown block "t/Nope"']);
});

test("edge to unknown node", () => {
    const g = graph({ s: "Source" }, [["s.y", "missing.u"]]);
    assert.deepEqual(errors(() => validateGraph(g)),
        ['Edge s.y -> missing.u: unknown node "missing"']);
});

test("edge from unknown node", () => {
    const g = graph({ k: "Gain" }, [["missing.y", "k.u"]]);
    // A broken edge doesn't count as a driver
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge missing.y -> k.u: unknown node "missing"',
        'Node "k": input "u" is not connected',
    ]);
});

test("unknown ports", () => {
    const g = graph({ s: "Source", k: "Gain" }, [["s.z", "k.u"], ["s.y", "k.v"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge s.z -> k.u: block "t/Source" has no output "z"',
        'Edge s.y -> k.v: block "t/Gain" has no input "v"',
        'Node "k": input "u" is not connected',
    ]);
});

test("port direction is checked", () => {
    // Gain has input u and output y, so reading from u or writing to y is wrong
    const g = graph({ s: "Source", a: "Gain", b: "Gain" }, [["s.y", "a.u"], ["a.u", "b.y"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge a.u -> b.y: block "t/Gain" has no output "u"',
        'Edge a.u -> b.y: block "t/Gain" has no input "y"',
        'Node "b": input "u" is not connected',
    ]);
});

test("Object.prototype keys aren't ports", () => {
    const g = graph({ s: "Source", k: "Gain" },
        [["s.y", "k.u"], ["s.toString", "k.u"], ["s.y", "k.constructor"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge s.toString -> k.u: block "t/Source" has no output "toString"',
        'Edge s.y -> k.constructor: block "t/Gain" has no input "constructor"',
    ]);
});

test("unconnected input", () => {
    const g = graph({ s: "Source", add: "Add" }, [["s.y", "add.a"]]);
    assert.deepEqual(errors(() => validateGraph(g)), ['Node "add": input "b" is not connected']);
});

test("input with multiple drivers", () => {
    const g = graph({ s: "Source", t: "Source", k: "Gain" }, [["s.y", "k.u"], ["t.y", "k.u"], ["s.y", "k.u"]]);
    assert.deepEqual(errors(() => validateGraph(g)), ['Node "k": input "u" has 3 incoming edges']);
});

test("unconnected output is allowed", () => {
    assert.doesNotThrow(() => validateGraph(graph({ s: "Source" }, [])));
});

test("all errors are collected", () => {
    const g = graph({ x: "Nope", k: "Gain", add: "Add" },
        [["k.y", "add.a"], ["k.y", "add.a"], ["k.y", "ghost.u"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Node "x": unknown block "t/Nope"',
        'Edge k.y -> ghost.u: unknown node "ghost"',
        'Node "k": input "u" is not connected',
        'Node "add": input "a" has 2 incoming edges',
        'Node "add": input "b" is not connected',
    ]);
});

test("block registration rejects invalid names", () => {
    const lib = createLibrary("t");
    const bad = stub({
        name: "my block",
        vars: ["T-1"],
        // Loaded JSON isn't type checked
        inputs: { "1u": F, v: { k: "named", name: "unsigned int" } as unknown as TypeExpr },
        outputs: { "y.z": tvar("T-1") },
        stateful: false,
    });
    assert.deepEqual(errors(() => addBlock(lib, bad)), [
        'my block: invalid block name "my block"',
        'my block: invalid type variable name "T-1"',
        'my block: invalid port name "1u"',
        'my block: unknown type "unsigned int"',
        'my block: invalid port name "y.z"',
    ]);
    assert.equal(lib.blocks.size, 0);
});

test("block registration rejects duplicate ports", () => {
    // Inputs and outputs share one namespace
    const lib = createLibrary("t");
    const bad = stub({ name: "Bad", vars: [], inputs: { x: F }, outputs: { x: F }, stateful: false });
    assert.deepEqual(errors(() => addBlock(lib, bad)), ['Bad: duplicate port "x"']);
});

test("block registration checks type variable declarations", () => {
    const lib = createLibrary("t");
    const bad = stub({ name: "Bad", vars: ["T", "U", "T"], inputs: { u: tvar("T") }, outputs: { y: tvar("V") }, stateful: false });
    assert.deepEqual(errors(() => addBlock(lib, bad)), [
        "Bad: duplicate type variables",
        'Bad: port "y" uses undeclared type variable "V"',
        'Bad: type variable "U" is not used by any port',
    ]);
});

test("block registration rejects duplicate names", () => {
    const lib = createLibrary("t");
    const decl: NativeBlock = stub({ name: "Src", vars: [], inputs: {}, outputs: { y: F }, stateful: false });
    addBlock(lib, decl);
    assert.deepEqual(errors(() => addBlock(lib, decl)), ["Src: block already registered"]);
});
