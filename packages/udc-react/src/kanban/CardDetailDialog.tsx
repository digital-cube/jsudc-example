import type { DescribeResponse, Row } from "@jsudc/core";
import { Dialog, DialogBody, DialogContent } from "../components/ui/dialog";
import { tableSection, useI18n } from "../i18n/i18n";
import { CellValue } from "../table/cells";

/**
 * A card, read-only: its title and body, then every live field as the table
 * formats it; the board and bucket ids read as their names. The tree opens
 * its nodes in it too, naming its own title and body fields.
 */
export function CardDetailDialog({
  row,
  describe,
  collection,
  labels,
  onClose,
  titleField = describe.view.kanban_options?.card.title_field,
  bodyField = describe.view.kanban_options?.card.body_field,
  testId = "kanban-detail",
}: {
  row: Row | undefined;
  describe: DescribeResponse;
  collection: string;
  /** Names for id fields the board knows (the board and the bucket), by field. */
  labels: Record<string, ReadonlyMap<string, string>>;
  onClose: () => void;
  titleField?: string | undefined;
  bodyField?: string | undefined;
  testId?: string;
}) {
  const { t, locale, intlLocale } = useI18n();
  const { schema, view } = describe;
  const section = tableSection(collection);
  const fields = schema.field_order.filter(
    (f) => !schema.fields[f]?.deleted && f !== titleField && f !== bodyField,
  );
  const body = row && bodyField ? row[bodyField] : null;

  return (
    <Dialog open={row !== undefined} onOpenChange={(open) => !open && onClose()}>
      {row ? (
        <DialogContent
          data-testid={testId}
          className="max-w-lg"
          title={String((titleField && row[titleField]) || "—")}
        >
          <DialogBody>
            {typeof body === "string" && body ? (
              <p className="mb-4 text-[13px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
                {body}
              </p>
            ) : null}
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 border-t border-border">
              {fields.map((field) => (
                <div key={field} className="contents" data-testid={`${testId}-${field}`}>
                  <dt className="border-b border-dashed border-border/80 py-2 text-xs text-muted-foreground">
                    {t(section, field)}
                  </dt>
                  <dd className="min-w-0 border-b border-dashed border-border/80 py-2 text-[13px]">
                    <CellValue
                      value={labels[field]?.get(String(row[field])) ?? row[field]}
                      column={view.columns.find((c) => c.field === field) ?? { field }}
                      def={schema.fields[field]}
                      locale={locale}
                      intlLocale={intlLocale}
                    />
                  </dd>
                </div>
              ))}
            </dl>
          </DialogBody>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
