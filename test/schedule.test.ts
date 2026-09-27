import { test } from "node:test";
import assert from "node:assert/strict";
import type { Graph } from "../src/base/graph.js";
import { addBlock, createLibrary, type Registry } from "../src/base/library.js";
import { feedthroughDeps, schedule as scheduleWith } from "../src/compiler/schedule.js";
import { graph, registry, stub } from "./helpers.js";

const T = { k: "named", name: "f32" } as const;

function makeLib(): Registry {
    return registry([
        { name: "Source", vars: [], inputs: {}, outputs: { y: T }, stateful: false },
        { name: "Gain", vars: [], inputs: { u: T }, outputs: { y: T }, stateful: false },
        { name: "Add", vars: [], inputs: { a: T, b: T }, outputs: { y: T }, stateful: false },
        { name: "Delay", vars: [], inputs: { u: T }, outputs: { y: T }, stateful: true, feedthrough: { y: [] } },
        { name: "Accum", vars: [], inputs: { u: T }, outputs: { y: T }, stateful: true },
    ]);
}

const schedule = (g: Graph, reg: Registry) => scheduleWith(g, reg, feedthroughDeps(g, reg));

test("chain follows edges", () => {
    const g = graph({ c: "Gain", b: "Gain", a: "Source" }, [["a.y", "b.u"], ["b.y", "c.u"]]);
    assert.deepEqual(schedule(g, makeLib()), { outputs: ["a", "b", "c"], updates: [] });
});

test("independent nodes keep insertion order", () => {
    const g = graph({ x: "Source", y: "Source", z: "Source" }, []);
    assert.deepEqual(schedule(g, makeLib()).outputs, ["x", "y", "z"]);
});

test("loop through delay is scheduled", () => {
    // s -> add -> d -> add.b
    const g = graph({ add: "Add", d: "Delay", s: "Source" },
        [["s.y", "add.a"], ["d.y", "add.b"], ["add.y", "d.u"]]);
    assert.deepEqual(schedule(g, makeLib()), { outputs: ["d", "s", "add"], updates: ["d"] });
});

test("loop through stateful block with feedthrough is rejected", () => {
    const g = graph({ s: "Source", add: "Add", acc: "Accum" },
        [["s.y", "add.a"], ["acc.y", "add.b"], ["add.y", "acc.u"]]);
    assert.throws(() => schedule(g, makeLib()), /Algebraic loop: acc -> add -> acc/);
});

test("self loop is rejected", () => {
    const g = graph({ s: "Source", add: "Add" }, [["s.y", "add.a"], ["add.y", "add.b"]]);
    assert.throws(() => schedule(g, makeLib()), /Algebraic loop: add -> add/);
});

test("node downstream of a loop is not reported", () => {
    const g = graph({ e: "Gain", a: "Gain", b: "Gain" },
        [["a.y", "b.u"], ["b.y", "a.u"], ["b.y", "e.u"]]);
    assert.throws(() => schedule(g, makeLib()), /Algebraic loop: a -> b -> a /);
});

test("invalid feedthrough is rejected on registration", () => {
    const lib = createLibrary("t");
    const bad = (feedthrough: Record<string, string[]>, stateful = true) =>
        stub({ name: "Bad", vars: [], inputs: { u: T }, outputs: { y: T }, stateful, feedthrough });
    assert.throws(() => addBlock(lib, bad({ z: [] })), /unknown output "z"/);
    assert.throws(() => addBlock(lib, bad({ y: ["v"] })), /unknown input "v"/);
    assert.throws(() => addBlock(lib, bad({ y: ["u", "u"] })), /duplicate feedthrough/);
    assert.throws(() => addBlock(lib, bad({ y: [] }, false)), /never reads input "u"/);
});
