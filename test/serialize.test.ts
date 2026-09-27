import { test } from "node:test";
import assert from "node:assert/strict";
import {
    addBlock, createLibrary, libraryFromJSON, libraryToJSON, Registry,
    type Library, type LibraryJSON,
} from "../src/base/library.js";
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
