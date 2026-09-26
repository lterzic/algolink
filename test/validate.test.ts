import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockDecl } from "../src/base/block.js";
import { registerBlock, type Library } from "../src/base/library.js";
import { validateGraph } from "../src/compiler/validate.js";
import { graph, named, tvar } from "./helpers.js";

const F = named("float");

// validateGraph only reads the global library; each test file runs in its own process
registerBlock({ name: "Source", inputs: {}, outputs: { y: F }, stateful: false });
registerBlock({ name: "Gain", inputs: { u: F }, outputs: { y: F }, stateful: false });
registerBlock({ name: "Add", inputs: { a: F, b: F }, outputs: { y: F }, stateful: false });

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
    assert.deepEqual(errors(() => validateGraph(g)), ['Node "x": unknown block "Nope"']);
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
        'Edge s.z -> k.u: block "Source" has no output "z"',
        'Edge s.y -> k.v: block "Gain" has no input "v"',
        'Node "k": input "u" is not connected',
    ]);
});

test("port direction is checked", () => {
    // Gain has input u and output y, so reading from u or writing to y is wrong
    const g = graph({ s: "Source", a: "Gain", b: "Gain" }, [["s.y", "a.u"], ["a.u", "b.y"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge a.u -> b.y: block "Gain" has no output "u"',
        'Edge a.u -> b.y: block "Gain" has no input "y"',
        'Node "b": input "u" is not connected',
    ]);
});

test("Object.prototype keys aren't ports", () => {
    const g = graph({ s: "Source", k: "Gain" },
        [["s.y", "k.u"], ["s.toString", "k.u"], ["s.y", "k.constructor"]]);
    assert.deepEqual(errors(() => validateGraph(g)), [
        'Edge s.toString -> k.u: block "Source" has no output "toString"',
        'Edge s.y -> k.constructor: block "Gain" has no input "constructor"',
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
        'Node "x": unknown block "Nope"',
        'Edge k.y -> ghost.u: unknown node "ghost"',
        'Node "k": input "u" is not connected',
        'Node "add": input "a" has 2 incoming edges',
        'Node "add": input "b" is not connected',
    ]);
});

test("block registration rejects invalid names", () => {
    const lib: Library = new Map();
    const bad: BlockDecl = {
        name: "my block",
        inputs: { "1u": F, v: named("unsigned int") },
        outputs: { "y.z": tvar("T-1") },
        stateful: false,
    };
    assert.deepEqual(errors(() => registerBlock(bad, lib)), [
        'my block: invalid block name "my block"',
        'my block: invalid port name "1u"',
        'my block: invalid type name "unsigned int"',
        'my block: invalid port name "y.z"',
        'my block: invalid type variable name "T-1"',
    ]);
    assert.equal(lib.size, 0);
});

test("block registration rejects duplicate ports", () => {
    // Inputs and outputs share one namespace
    const lib: Library = new Map();
    const bad: BlockDecl = { name: "Bad", inputs: { x: F }, outputs: { x: F }, stateful: false };
    assert.deepEqual(errors(() => registerBlock(bad, lib)), ['Bad: duplicate port "x"']);
});

test("block registration rejects duplicate names", () => {
    const lib: Library = new Map();
    const decl: BlockDecl = { name: "Src", inputs: {}, outputs: { y: F }, stateful: false };
    registerBlock(decl, lib);
    assert.deepEqual(errors(() => registerBlock(decl, lib)), ["Src: block already registered"]);
});
