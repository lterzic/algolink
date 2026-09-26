import { test } from "node:test";
import assert from "node:assert/strict";
import type { BlockDecl } from "../src/base/block.js";
import { registerBlock, type Library } from "../src/base/library.js";
import { schedule } from "../src/compiler/schedule.js";
import { graph } from "./helpers.js";

const T = { k: "named", name: "float" } as const;

function makeLib(): Library {
    const lib: Library = new Map();
    const blocks: BlockDecl[] = [
        { name: "Source", inputs: {}, outputs: { y: T }, stateful: false },
        { name: "Gain", inputs: { u: T }, outputs: { y: T }, stateful: false },
        { name: "Add", inputs: { a: T, b: T }, outputs: { y: T }, stateful: false },
        { name: "Delay", inputs: { u: T }, outputs: { y: T }, stateful: true, feedthrough: { y: [] } },
        { name: "Accum", inputs: { u: T }, outputs: { y: T }, stateful: true },
    ];
    for (const b of blocks) registerBlock(b, lib);
    return lib;
}

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
    const lib: Library = new Map();
    const bad = (feedthrough: Record<string, string[]>, stateful = true): BlockDecl =>
        ({ name: "Bad", inputs: { u: T }, outputs: { y: T }, stateful, feedthrough });
    assert.throws(() => registerBlock(bad({ z: [] }), lib), /unknown output "z"/);
    assert.throws(() => registerBlock(bad({ y: ["v"] }), lib), /unknown input "v"/);
    assert.throws(() => registerBlock(bad({ y: ["u", "u"] }), lib), /duplicate feedthrough/);
    assert.throws(() => registerBlock(bad({ y: [] }, false), lib), /never reads input "u"/);
});
