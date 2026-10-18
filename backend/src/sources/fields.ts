import {
  type FieldDef,
  type FilterNode,
  isCondition,
  isValidFieldName,
  type RowProblem,
  type SchemaDoc,
  type SortKey,
  UdcError,
  type ValidateMode,
  validateRow,
} from "@jsudc/udc-core";

/**
 * The allowlist: a field may appear in a filter or a sort only when it is a
 * non-deleted field of the active schema and passes `FIELD_NAME_RE`. Only a
 * name that got through here is ever written into SQL.
 */
export function allowedField(schema: SchemaDoc, field: string, where: string): FieldDef {
  const def = Object.hasOwn(schema.fields, field) ? schema.fields[field] : undefined;
  if (!isValidFieldName(field) || !def || def.deleted) {
    throw new UdcError("validation_error", `unknown field in ${where}: ${JSON.stringify(field)}`, {
      field,
      where,
    });
  }
  return def;
}

export function filterFields(node: FilterNode | null | undefined): string[] {
  if (!node) return [];
  if (isCondition(node)) return [node.field];
  if ("and" in node) return node.and.flatMap(filterFields);
  if ("or" in node) return node.or.flatMap(filterFields);
  return filterFields(node.not);
}

/** Check every field a list request names before anything runs. */
export function assertQueryFields(
  schema: SchemaDoc,
  filter: FilterNode | undefined,
  sort: SortKey[] | undefined,
): void {
  for (const field of filterFields(filter)) allowedField(schema, field, "filter");
  for (const key of sort ?? []) allowedField(schema, key.field, "sort");
}

export function assertValidRow(
  schema: SchemaDoc,
  row: Record<string, unknown>,
  mode: ValidateMode,
): void {
  const problems: RowProblem[] = validateRow(schema, row, { mode });
  if (problems.length > 0) {
    const summary = problems.map((p) => `${p.field} ${p.message}`).join("; ");
    throw new UdcError("validation_error", `invalid row: ${summary}`, { problems });
  }
}

/** The stored fields of an incoming row: `__meta` is the server's, never data. */
export function withoutMeta(row: Record<string, unknown>): Record<string, unknown> {
  const { __meta: _, ...data } = row;
  return data;
}

export function notFound(id: string): UdcError {
  return new UdcError("not_found", `no row with id ${id}`, { id });
}

export function versionConflict(id: string, expected: number, current: number): UdcError {
  return new UdcError("version_conflict", `row ${id} is at version ${current}, not ${expected}`, {
    id,
    expected_version: expected,
    current_version: current,
  });
}
