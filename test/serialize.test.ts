import { test } from "node:test";
import assert from "node:assert/strict";
import { addBlock, createLibrary, type Library } from "../src/library/library.js";
import { Registry } from "../src/library/registry.js";
import { libraryFromJSON, libraryToJSON, type LibraryJSON } from "../src/library/serialize.js";
import { compileNested } from "../src/compiler/nested.js";
import { createStdLibrary } from "../src/std/std.js";
import { graph, tvar } from "./helpers.js";

const T = tvar("T");

function withStd() {
    const reg = new Registry();
    reg.add(createStdLibrary());
    return reg;
}

// A native block, and a nested one that uses it and std
function userLibrary(reg: Registry): Library {
    const lib = createLibrary("u");
    reg.add(lib);
    addBlock(lib, {
        k: "native", name: "Twice", vars: ["T"], inputs: { x: T }, outputs: { y: T }, stateful: false,
        impl: { c: { output: "{y} = 2 * {x};" } },
    });
    addBlock(lib, compileNested("Filter", graph({ x: "core/In", t: "u/Twice", d: "std/Delay", y: "core/Out" },
        [["x.y", "t.x"], ["t.y", "d.u"], ["d.y", "y.u"]]), reg));
    return lib;
}

// Through a string, like a file
const roundTrip = (lib: Library): LibraryJSON => JSON.parse(JSON.stringify(libraryToJSON(lib))) as LibraryJSON;

test("library round-trips", () => {
    const lib = userLibrary(withStd());
    const loaded = libraryFromJSON(roundTrip(lib), withStd());
    assert.deepEqual(loaded, lib);
});

test("nested blocks store only their graph", () => {
    const json = libraryToJSON(userLibrary(withStd()));
    assert.deepEqual(Object.keys(json.blocks[1]!), ["k", "name", "graph"]);
});

test("node order survives integer-like ids", () => {
    const reg = withStd();
    const lib = createLibrary("u");
    reg.add(lib);
    const g = graph({ x: "core/In", 2: "std/Neg", 1: "std/Neg", y: "core/Out" },
        [["x.y", "2.x"], ["2.y", "1.x"], ["1.y", "y.u"]]);
    addBlock(lib, compileNested("N", g, reg));
    const loaded = libraryFromJSON(roundTrip(lib), withStd()).blocks.get("N")!;
    assert.deepEqual(loaded.k === "nested" && [...loaded.graph.nodes.keys()], [...g.nodes.keys()]);
});

test("missing dependency fails and leaves the registry unchanged", () => {
    const json = roundTrip(userLibrary(withStd()));
    const reg = new Registry(); // No std
    assert.throws(() => libraryFromJSON(json, reg), /unknown block "std\/Delay"/);
    assert.equal(reg.library("u"), undefined);

    reg.add(createStdLibrary());
    assert.doesNotThrow(() => libraryFromJSON(json, reg));
});

test("unsupported version", () => {
    const json = { ...roundTrip(userLibrary(withStd())), version: 2 } as unknown as LibraryJSON;
    assert.throws(() => libraryFromJSON(json, withStd()), { message: "u: unsupported library version 2" });
});

// Blocks in JSON order, with the nested block first
const nestedFirst = (): LibraryJSON => {
    const json = roundTrip(userLibrary(withStd()));
    return { ...json, blocks: [json.blocks[1]!, json.blocks[0]!] };
};

test("nested blocks may come before the blocks they use", () => {
    const outer = { k: "nested" as const, name: "Outer", graph: {
        nodes: [{ id: "x", block: "core/In" }, { id: "f", block: "u/Filter" }, { id: "y", block: "core/Out" }],
        edges: [
            { sourceNode: "x", sourcePort: "y", targetNode: "f", targetPort: "x" },
            { sourceNode: "f", sourcePort: "y", targetNode: "y", targetPort: "u" },
        ],
    } };
    const json = nestedFirst();
    const lib = libraryFromJSON({ ...json, blocks: [outer, ...json.blocks] }, withStd());
    assert.deepEqual([...lib.blocks.keys()], ["Twice", "Filter", "Outer"]);
});

test("recursive nested blocks fail and leave the registry unchanged", () => {
    const self = { k: "nested" as const, name: "Self", graph: {
        nodes: [{ id: "x", block: "core/In" }, { id: "s", block: "u/Self" }, { id: "y", block: "core/Out" }],
        edges: [
            { sourceNode: "x", sourcePort: "y", targetNode: "s", targetPort: "x" },
            { sourceNode: "s", sourcePort: "y", targetNode: "y", targetPort: "u" },
        ],
    } };
    const json = nestedFirst();
    const reg = withStd();
    assert.throws(() => libraryFromJSON({ ...json, blocks: [...json.blocks, self] }, reg),
        { message: "Recursive block: u/Self -> u/Self" });
    assert.equal(reg.library("u"), undefined);
});

test("a nested block can't share a name with another block", () => {
    const json = nestedFirst();
    const clash = { ...json.blocks[0]!, name: "Twice" };
    assert.throws(() => libraryFromJSON({ ...json, blocks: [...json.blocks, clash] }, withStd()),
        { message: "Twice: block already registered" });
});
