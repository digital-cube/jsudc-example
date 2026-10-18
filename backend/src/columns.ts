import type { ColumnConfig, SchemaDoc } from "@jsudc/udc-core";

/**
 * The table columns `describe` serves: `view.columns` in file order (the
 * styled base layout), minus columns of deleted fields, plus a default column
 * for every non-deleted schema field the view does not list. A derived column
 * goes right after the last column of the nearest preceding field in
 * `field_order` that has one, or first when there is none, so
 * `schema.add_field` with `position: before|after` shows up where asked.
 */
export function deriveColumns(
  columns: readonly ColumnConfig[],
  schema: Pick<SchemaDoc, "fields" | "field_order">,
  defaultWidth: number,
): ColumnConfig[] {
  const isDeleted = (field: string) => schema.fields[field]?.deleted === true;
  const out = columns.filter((c) => !isDeleted(c.field));
  const listed = new Set(out.map((c) => c.field));

  schema.field_order.forEach((field, i) => {
    if (listed.has(field) || isDeleted(field) || !schema.fields[field]) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const neighbour = schema.field_order[j];
      const last = out.findLastIndex((c) => c.field === neighbour);
      if (last >= 0) {
        at = last + 1;
        break;
      }
    }
    out.splice(at, 0, { field, width: defaultWidth, editable: true });
    listed.add(field);
  });

  return out;
}
