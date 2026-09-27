import { test } from "node:test";
import assert from "node:assert/strict";
import { createProject, elaborate, removeGraph, setGraph, type Project } from "../src/project/project.js";
import { projectFromJSON, projectToJSON, type ProjectFiles } from "../src/project/serialize.js";
import { createStdLibrary } from "../src/std/std.js";
import { graph, named, stubLibrary, tvar } from "./helpers.js";

const F = named("f32");
const I = named("i32");

const deps = () => [
    stubLibrary([
        { name: "F2F", vars: [], inputs: { u: F }, outputs: { y: F }, stateful: false },
        { name: "ToInt", vars: ["T"], inputs: { u: tvar("T") }, outputs: { y: I }, stateful: false },
    ]),
    createStdLibrary(),
];

// y = x + previous y, generic
const accum = () => graph({ x: "core/In", sum: "std/Add", d: "std/Delay", y: "core/Out" },
    [["x.y", "sum.a"], ["d.y", "sum.b"], ["sum.y", "d.u"], ["sum.y", "y.u"]]);

// Graphs are added in the given order
function project(graphs: Record<string, ReturnType<typeof graph>>, targets: string[]): Project {
    const p = createProject("p", deps());
    for (const [name, g] of Object.entries(graphs)) setGraph(p, name, g);
    p.targets = targets;
    return p;
}

const pass = (u: string) => graph({ x: "core/In", b: u, y: "core/Out" }, [["x.y", "b.x"], ["b.y", "y.u"]]);

test("graphs may use graphs declared after them", () => {
    const p = project({ Outer: pass("p/Accum"), Accum: accum() }, ["Outer"]);
    elaborate(p);
    const outer = p.library.blocks.get("Outer")!;
    assert.deepEqual([outer.vars, outer.stateful, outer.feedthrough], [["T0"], true, { y: ["x"] }]);
    assert.deepEqual([...p.library.blocks.keys()], ["Accum", "Outer"]);
});

test("a generic graph is used at two types", () => {
    const p = project({
        Accum: accum(),
        Two: graph({ x: "core/In", f: "t/F2F", i: "t/ToInt", a1: "p/Accum", a2: "p/Accum", y1: "core/Out", y2: "core/Out" },
            [["x.y", "f.u"], ["x.y", "i.u"], ["f.y", "a1.x"], ["i.y", "a2.x"], ["a1.y", "y1.u"], ["a2.y", "y2.u"]]),
    }, ["Two"]);
    elaborate(p);
    const two = p.library.blocks.get("Two")!;
    assert.deepEqual([two.vars, two.inputs, two.outputs], [[], { x: F }, { y1: F, y2: I }]);
});

test("recursion is rejected", () => {
    assert.throws(() => elaborate(project({ A: pass("p/A") }, ["A"])), { message: "Recursive block: p/A -> p/A" });

    const p = project({ Top: pass("p/A"), A: pass("p/B"), B: pass("p/A") }, ["Top"]);
    assert.throws(() => elaborate(p), { message: "Recursive block: p/A -> p/B -> p/A" });
});

test("errors name the graphs that led to them", () => {
    const p = project({ Outer: pass("p/Inner"), Inner: pass("std/Nope") }, ["Outer"]);
    assert.throws(() => elaborate(p), /: p\/Outer -> p\/Inner: Node "b": unknown block "std\/Nope"\n/);
});

test("graphs no target uses aren't compiled", () => {
    const p = project({ Accum: accum(), Broken: pass("std/Nope") }, ["Accum"]);
    elaborate(p);
    assert.deepEqual([...p.library.blocks.keys()], ["Accum"]);
    assert.throws(() => elaborate(p, ["Missing"]), { message: "p/Missing: no such graph" });
});

test("changing a graph drops compiled blocks", () => {
    const p = project({ Accum: accum(), Outer: pass("p/Accum") }, ["Outer"]);
    elaborate(p);
    setGraph(p, "Accum", graph({ x: "core/In", f: "t/F2F", y: "core/Out" }, [["x.y", "f.u"], ["f.y", "y.u"]]));
    assert.equal(p.library.blocks.size, 0);
    elaborate(p);
    assert.deepEqual(p.library.blocks.get("Outer")!.inputs, { x: F });

    removeGraph(p, "Accum");
    assert.throws(() => elaborate(p), /unknown block "p\/Accum"/);
});

test("compiled blocks keep their own copy of the graph", () => {
    const g = accum();
    const p = project({ Accum: g }, ["Accum"]);
    elaborate(p);
    g.nodes.delete("d");
    const b = p.library.blocks.get("Accum")!;
    assert.ok(b.k === "nested" && b.graph.nodes.has("d"));
});

// Through strings, like files
const roundTrip = (p: Project): ProjectFiles => JSON.parse(JSON.stringify(projectToJSON(p))) as ProjectFiles;

test("project round-trips with editor data", () => {
    const g = accum();
    g.ui = { zoom: 2 };
    g.nodes.get("sum")!.ui = { x: 10, y: 20 };
    const p = project({ Accum: g, Outer: pass("p/Accum") }, ["Outer"]);

    const files = roundTrip(p);
    assert.deepEqual(files.project, { version: 1, name: "p", dependencies: ["t", "std"], targets: ["Outer"] });

    const loaded = projectFromJSON(files, deps());
    assert.deepEqual([loaded.graphs, loaded.targets], [p.graphs, p.targets]);
    assert.deepEqual(roundTrip(loaded), files);
});

test("broken graphs load and fail on elaborate", () => {
    const files = roundTrip(project({ Broken: pass("std/Nope") }, ["Broken"]));
    const p = projectFromJSON(files, deps());
    assert.throws(() => elaborate(p), /unknown block "std\/Nope"/);
});

test("loading checks dependencies and versions", () => {
    const files = roundTrip(project({ Accum: accum() }, []));
    assert.throws(() => projectFromJSON(files, [createStdLibrary()]), { message: "p: missing dependencies t" });
    assert.throws(() => projectFromJSON({ ...files, project: { ...files.project, version: 2 as 1 } }, deps()),
        { message: "p: unsupported project version 2" });

    const dup = { ...files, graphs: [...files.graphs, ...files.graphs] };
    assert.throws(() => projectFromJSON(dup, deps()), { message: "p/Accum: duplicate graph" });
});
