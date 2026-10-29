import type { CalendarOptions, DescribeResponse } from "@jsudc/core";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "../components/ui/popover";
import { tableSection, useI18n } from "../i18n/i18n";
import { CellEditor, editorKind, fromEditorValue, sameValue } from "../table/CellEditor";
import { CellValue } from "../table/cells";
import { formatDay, formatTime, zonedParts } from "../time/zoned";
import { eventTint } from "./EventBlock";
import type { CalendarEvent } from "./model";

/**
 * The popover a clicked event opens: its time in the display zone, then
 * `detail.fields` as the table formats them; the ones marked `editable` edit
 * in place with the table's cell editor. Delete, when `detail.delete`, asks
 * once more before it deletes.
 */
export function EventDetail({
  ev,
  anchor,
  collection,
  describe,
  opts,
  timeZone,
  readOnly,
  onClose,
  onSave,
  onDelete,
}: {
  ev: CalendarEvent;
  anchor: HTMLElement;
  collection: string;
  describe: DescribeResponse;
  opts: CalendarOptions;
  timeZone: string;
  readOnly: boolean;
  onClose: () => void;
  onSave: (field: string, value: unknown) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const { t, locale, intlLocale } = useI18n();
  const { schema, view } = describe;
  const section = tableSection(collection);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ message: string; seq: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fields = (opts.detail?.fields ?? [{ field: opts.title_field }]).filter(
    (f) => schema.fields[f.field] && !schema.fields[f.field]?.deleted,
  );

  const sameDate = (() => {
    const a = zonedParts(ev.start, timeZone);
    const b = zonedParts(ev.end - 1, timeZone);
    return a.y === b.y && a.m === b.m && a.d === b.d;
  })();
  const dateOf = (instant: number) => {
    const p = zonedParts(instant, timeZone);
    return formatDay(p, intlLocale, { weekday: "short", day: "numeric", month: "short" });
  };
  const when = sameDate
    ? `${dateOf(ev.start)}, ${formatTime(ev.start, intlLocale, timeZone)} – ${formatTime(ev.end, intlLocale, timeZone)}`
    : `${dateOf(ev.start)} ${formatTime(ev.start, intlLocale, timeZone)} – ${dateOf(ev.end)} ${formatTime(ev.end, intlLocale, timeZone)}`;

  const commit = async (field: string, raw: string | boolean) => {
    const def = schema.fields[field];
    const parsed = fromEditorValue(raw, editorKind(def), def);
    if ("error" in parsed) {
      setError((e) => ({ message: parsed.error, seq: (e?.seq ?? 0) + 1 }));
      return;
    }
    if (sameValue(parsed.value, ev.row[field])) {
      setEditing(null);
      return;
    }
    setSaving(true);
    try {
      await onSave(field, parsed.value);
      setEditing(null);
      setError(null);
    } catch (err) {
      setError((e) => ({ message: (err as Error).message, seq: (e?.seq ?? 0) + 1 }));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor virtualRef={{ current: anchor }} />
      <PopoverContent
        side="right"
        align="start"
        collisionPadding={12}
        className="w-80 p-0"
        data-testid="cal-detail"
        data-event-id={ev.id}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div
          className="rounded-t-lg border-b border-l-4 border-border px-3 py-2.5"
          style={eventTint(ev.color, 12)}
        >
          <div className="text-sm leading-snug font-semibold" data-testid="cal-detail-title">
            {ev.title}
          </div>
          <div
            className="mt-0.5 text-xs text-muted-foreground tabular-nums"
            data-testid="cal-detail-when"
          >
            {when}
          </div>
        </div>
        <dl className="grid grid-cols-[minmax(5.5rem,auto)_1fr] gap-x-3 px-3 py-1">
          {fields.map(({ field, editable }) => {
            const def = schema.fields[field];
            const canEdit = editable === true && !readOnly;
            const column = view.columns.find((c) => c.field === field) ?? { field };
            return (
              <div key={field} className="contents" data-testid={`cal-detail-${field}`}>
                <dt className="border-b border-dashed border-border/80 py-2 text-xs text-muted-foreground">
                  {t(section, field)}
                </dt>
                <dd className="relative min-w-0 border-b border-dashed border-border/80 py-1.5 text-[13px]">
                  {editing === field ? (
                    <div className="relative h-7">
                      <CellEditor
                        def={def}
                        initial={ev.row[field]}
                        saving={saving}
                        error={error?.message ?? null}
                        errorSeq={error?.seq ?? 0}
                        onCommit={(raw) => void commit(field, raw)}
                        onCancel={() => {
                          setEditing(null);
                          setError(null);
                        }}
                      />
                    </div>
                  ) : canEdit ? (
                    <button
                      type="button"
                      data-testid={`cal-detail-edit-${field}`}
                      onClick={() => setEditing(field)}
                      className="group/edit flex min-h-7 w-full min-w-0 items-center gap-1.5 rounded px-1 -mx-1 text-left hover:bg-hover"
                    >
                      <span className="min-w-0 flex-1">
                        <CellValue
                          value={ev.row[field]}
                          column={column}
                          def={def}
                          locale={locale}
                          intlLocale={intlLocale}
                        />
                      </span>
                      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover/edit:opacity-100" />
                    </button>
                  ) : (
                    <div className="flex min-h-7 items-center">
                      <CellValue
                        value={ev.row[field]}
                        column={column}
                        def={def}
                        locale={locale}
                        intlLocale={intlLocale}
                      />
                    </div>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
        {opts.detail?.delete && !readOnly ? (
          <div className="flex items-center justify-end gap-2 px-3 py-2.5">
            {confirming ? (
              <>
                <span className="mr-auto text-xs text-muted-foreground">
                  {t("APP", "CAL_DELETE_CONFIRM")}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  {t("APP", "CAL_CANCEL")}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  data-testid="cal-delete-confirm"
                  onClick={() => void onDelete()}
                >
                  {t("APP", "CAL_DELETE")}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                data-testid="cal-delete"
                className="text-sem-danger hover:text-sem-danger"
                onClick={() => setConfirming(true)}
              >
                <Trash2 />
                {t("APP", "CAL_DELETE")}
              </Button>
            )}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
