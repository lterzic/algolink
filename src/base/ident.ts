// Excludes '.', which the compiler uses to qualify names with node ids
export const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function checkIdent(errors: string[], owner: string, what: string, name: string) {
    if (!IDENT.test(name))
        errors.push(`${owner}: invalid ${what} name "${name}"`);
}
