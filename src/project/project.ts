import type { Graph } from "../base/graph.js";
import { elaborate as elaborateGraphs } from "../library/elaborate.js";
import { createLibrary, type Library } from "../library/library.js";
import { Registry } from "../library/registry.js";

// A set of graphs being authored, compiled into a library named after the project.
// Other projects can load that library like any other
export interface Project {
    name: string;
    registry: Registry; // core, dependencies, and library
    library: Library; // Compiled graphs, filled by elaborate
    graphs: Map<string, Graph>; // Sources, by block name
    targets: string[]; // Graphs to build, each with the graphs it uses
}

export function createProject(name: string, deps: Library[] = []): Project {
    const registry = new Registry();
    for (const lib of deps) registry.add(lib);
    const library = createLibrary(name);
    registry.add(library);
    return { name, registry, library, graphs: new Map(), targets: [] };
}

// Compiled blocks may use any graph, so all of them are dropped until the next elaborate
export function setGraph(p: Project, name: string, g: Graph) {
    p.graphs.set(name, g);
    p.library.blocks.clear();
}

export function removeGraph(p: Project, name: string) {
    p.graphs.delete(name);
    p.library.blocks.clear();
}

// Compiles the targets and every graph they use. Graphs no target reaches aren't compiled,
// so they may be broken
export function elaborate(p: Project, targets: Iterable<string> = p.targets) {
    elaborateGraphs(p.library, p.graphs, p.registry, targets);
}
