import type { Library } from "../library/library.js";
import { CORE } from "../library/registry.js";
import { graphFromJSON, graphToJSON, type GraphJSON } from "../library/serialize.js";
import { createProject, type Project } from "./project.js";

export interface ProjectJSON {
    version: 1;
    name: string;
    dependencies: string[]; // Library names, in load order
    targets: string[];
}

// One file per graph; the graph files present are the project's graphs
export interface GraphFileJSON extends GraphJSON {
    version: 1;
    name: string;
}

export interface ProjectFiles {
    project: ProjectJSON;
    graphs: GraphFileJSON[];
}

export function projectToJSON(p: Project): ProjectFiles {
    const dependencies = p.registry.names().filter(n => n !== CORE && n !== p.name);
    return {
        project: { version: 1, name: p.name, dependencies, targets: [...p.targets] },
        graphs: [...p.graphs].map(([name, g]) => ({ version: 1, name, ...graphToJSON(g) })),
    };
}

// deps must provide every library the project depends on. Graphs are only parsed,
// so a project with broken graphs still loads and fails on elaborate
export function projectFromJSON(files: ProjectFiles, deps: Library[]): Project {
    const { project: json } = files;
    if (json.version !== 1)
        throw new Error(`${json.name}: unsupported project version ${json.version}`);

    const byName = new Map(deps.map(lib => [lib.name, lib]));
    const missing = json.dependencies.filter(n => !byName.has(n));
    if (missing.length)
        throw new Error(`${json.name}: missing dependencies ${missing.join(", ")}`);

    const p = createProject(json.name, json.dependencies.map(n => byName.get(n)!));
    p.targets = [...json.targets];
    for (const { version, name, ...graph } of files.graphs) {
        if (version !== 1)
            throw new Error(`${json.name}/${name}: unsupported graph version ${version}`);
        if (p.graphs.has(name))
            throw new Error(`${json.name}/${name}: duplicate graph`);
        p.graphs.set(name, graphFromJSON(graph));
    }
    return p;
}
