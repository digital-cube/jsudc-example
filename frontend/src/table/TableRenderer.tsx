import {
  type ColumnConfig,
  type DescribeResponse,
  type FieldDef,
  isUdcError,
  isVersionConflict,
  type Row,
  type SortKey,
  type UdcError,
} from "@jsudc/core";
import { type Column, type ColumnDef, getCoreRowModel, useReactTable } from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown, Plus } from "lucide-react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { Skeleton, Spinner } from "../components/ui/misc";
import { useToast } from "../components/ui/toast";
import { FolderEntry } from "../data-view/FolderEntry";
import { tableSection, useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";
import type { FolderNav } from "../renderers/types";
import { ColumnHeaderMenu } from "../schema-editor/ColumnHeaderMenu";
import type { SchemaAction } from "../schema-editor/fieldForm";
import type { UdcCollectionResult } from "../udc/hooks";
import { useUdcMutate } from "../udc/hooks";
import type { PagingMode } from "../udc/keys";
import {
  CellEditor,
  type CommitReason,
  editorKind,
  fromEditorValue,
  sameValue,
} from "./CellEditor";
import { CellValue } from "./cells";
import { Pager } from "./Pager";
import { EmptyState, ErrorState } from "./states";
import { BG_COLOR, resolveRowColor, TEXT_COLOR } from "./style";
import { useInfiniteSentinel } from "./useInfiniteSentinel";

interface ColMeta {
  config: ColumnConfig;
  def: FieldDef | undefined;
}

const meta = (c: Column<Row, unknown>) => c.columnDef.meta as ColMeta;

const SKELETON_ROWS = 12;
const DEFAULT_ROW_HEIGHT = 40;
/** The trailing `+` header cell that adds a column at the end. */
const ADD_COLUMN_WIDTH = 44;

/** The message a `validation_error` carries for one field, else its overall message. */
export function fieldProblem(err: UdcError, field: string): string {
  const problems = err.details?.problems;
  if (Array.isArray(problems)) {
    const hit = problems.find(
      (p): p is { field: string; message: string } =>
        !!p && typeof p === "object" && (p as { field?: unknown }).field === field,
    );
    if (hit) return hit.message;
  }
  return err.message;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export interface TableRendererProps {
  collection: string;
  describe: DescribeResponse;
  data: UdcCollectionResult;
  mode: PagingMode;
  page: number;
  limit: number;
  onPage: (page: number) => void;
  sort: SortKey[];
  onSort: (field: string, multi: boolean) => void;
  filtered: boolean;
  onClearFilters: () => void;
  /** Changes whenever the rows are a different query; scrolls back to the top. */
  resetKey: string;
  /** Set when the schema may be edited: shows the column menus and the trailing `+`. */
  onSchemaAction?: ((a: SchemaAction) => void) | undefined;
  /** A folder listing: the label column opens folders and previews files. */
  folder?: FolderNav | undefined;
}

type EditTarget = { rowId: string; colId: string };

export function TableRenderer(props: TableRendererProps) {
  const { collection, describe, data, mode, sort } = props;
  const { view, schema, capabilities } = describe;
  const { t, locale, intlLocale } = useI18n();
  const { toast } = useToast();
  const mutate = useUdcMutate(collection);
  const section = tableSection(collection);

  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [edit, setEdit] = useState<EditTarget | null>(null);
  const [editError, setEditError] = useState<{ message: string; seq: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const columns = useMemo<ColumnDef<Row>[]>(
    () =>
      view.columns
        .filter((c) => schema.fields[c.field]?.deleted !== true)
        .map((c) => ({
          id: c.id ?? c.field,
          accessorFn: (r: Row) => r[c.field],
          size: c.width ?? view.default_column_width,
          meta: { config: c, def: schema.fields[c.field] } satisfies ColMeta,
        })),
    [view.columns, view.default_column_width, schema.fields],
  );

  const columnPinning = useMemo(
    () => ({
      left: view.columns.filter((c) => c.pin === "left").map((c) => c.id ?? c.field),
      right: view.columns.filter((c) => c.pin === "right").map((c) => c.id ?? c.field),
    }),
    [view.columns],
  );

  const table = useReactTable({
    data: data.rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.__meta.id,
    manualSorting: true,
    manualPagination: true,
    state: {
      columnPinning,
      sorting: sort.map((k) => ({ id: k.field, desc: k.dir === "desc" })),
    },
  });

  const left = table.getLeftLeafColumns();
  const center = table.getCenterLeafColumns();
  const right = table.getRightLeafColumns();
  const ordered = [...left, ...center, ...right];
  const schemaEdit = capabilities.schema_edit && props.onSchemaAction !== undefined;
  const totalWidth =
    ordered.reduce((sum, c) => sum + c.getSize(), 0) + (schemaEdit ? ADD_COLUMN_WIDTH : 0);
  const rowHeight = view.row_height ?? DEFAULT_ROW_HEIGHT;

  const canEdit = (c: Column<Row, unknown>) =>
    capabilities.mutate && meta(c).config.editable === true && meta(c).def !== undefined;
  const editableIds = ordered.filter(canEdit).map((c) => c.id);

  // Pinned-edge shadows appear only once there is something scrolled under them.
  const measureEdges = () => {
    const el = scrollRef.current;
    if (!el) return;
    const next = {
      left: el.scrollLeft > 0,
      right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
    };
    setEdges((prev) => (prev.left === next.left && prev.right === next.right ? prev : next));
  };
  useEffect(() => {
    measureEdges();
    window.addEventListener("resize", measureEdges);
    return () => window.removeEventListener("resize", measureEdges);
  });

  useEffect(() => {
    if (props.resetKey && scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [props.resetKey]);

  // Infinite mode: the sentinel under the last row asks for the next page.
  const { hasNextPage, isFetchingNextPage } = data;
  useInfiniteSentinel(mode === "infinite", scrollRef, sentinelRef, data);

  const focusCell = (target: EditTarget) =>
    requestAnimationFrame(() => {
      const sel = `[data-cell="${CSS.escape(`${target.rowId}:${target.colId}`)}"]`;
      scrollRef.current?.querySelector<HTMLElement>(sel)?.focus();
    });

  const startEdit = (target: EditTarget) => {
    setEditError(null);
    setEdit(target);
  };

  const commit = async (
    row: Row,
    col: Column<Row, unknown>,
    raw: string | boolean,
    reason: CommitReason,
  ) => {
    const { config, def } = meta(col);
    const target = { rowId: row.__meta.id, colId: col.id };
    const parsed = fromEditorValue(raw, editorKind(def), def);
    if ("error" in parsed) {
      setEditError((e) => ({ message: capitalize(parsed.error), seq: (e?.seq ?? 0) + 1 }));
      return;
    }
    const finish = () => {
      setEditError(null);
      if (reason === "tab" || reason === "shift-tab") {
        const i = editableIds.indexOf(col.id) + (reason === "tab" ? 1 : -1);
        const next = editableIds[i];
        if (next) return startEdit({ rowId: row.__meta.id, colId: next });
      }
      setEdit(null);
      if (reason !== "blur") focusCell(target);
    };

    if (sameValue(parsed.value, row[config.field])) return finish();

    setSaving(true);
    try {
      await mutate.mutateAsync({
        op: "update",
        id: row.__meta.id,
        row: { [config.field]: parsed.value },
        expected_version: row.__meta.version,
      });
      setSaving(false);
      finish();
    } catch (err) {
      setSaving(false);
      if (isUdcError(err) && err.code === "validation_error") {
        setEditError((e) => ({
          message: capitalize(fieldProblem(err, config.field)),
          seq: (e?.seq ?? 0) + 1,
        }));
        return;
      }
      setEdit(null);
      setEditError(null);
      if (isVersionConflict(err)) {
        toast({
          variant: "warning",
          title: t("APP", "CONFLICT_TITLE"),
          description: t("APP", "CONFLICT_BODY"),
        });
      } else {
        toast({
          variant: "danger",
          title: t("APP", "SAVE_FAILED"),
          description: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const pinStyle = (c: Column<Row, unknown>): CSSProperties => {
    const pin = c.getIsPinned();
    const width = c.getSize();
    if (pin === "left") return { width, left: c.getStart("left") };
    if (pin === "right") return { width, right: c.getAfter("right") };
    return { width };
  };

  const pinClass = (c: Column<Row, unknown>) => {
    const pin = c.getIsPinned();
    if (!pin) return "";
    const edge = pin === "left" ? c.getIsLastColumn("left") : c.getIsFirstColumn("right");
    return cn(
      "sticky z-[5]",
      edge &&
        pin === "left" &&
        "after:pointer-events-none after:absolute after:inset-y-0 after:-right-3 after:w-3 after:bg-gradient-to-r after:from-[var(--shadow-pin)] after:to-transparent after:opacity-0 after:transition-opacity",
      edge && pin === "left" && edges.left && "after:opacity-100",
      edge &&
        pin === "right" &&
        "before:pointer-events-none before:absolute before:inset-y-0 before:-left-3 before:w-3 before:bg-gradient-to-l before:from-[var(--shadow-pin)] before:to-transparent before:opacity-0 before:transition-opacity",
      edge && pin === "right" && edges.right && "before:opacity-100",
    );
  };

  const alignClass = (c: Column<Row, unknown>) => {
    const a = meta(c).config.align;
    return a === "right"
      ? "text-right justify-end"
      : a === "center"
        ? "text-center justify-center"
        : "";
  };

  const showSkeleton = data.isLoading && data.rows.length === 0;
  const showError = data.error !== null && data.rows.length === 0;
  const showEmpty = !showSkeleton && !showError && data.rows.length === 0;
  const total = data.total ?? data.rows.length;

  const header = (c: Column<Row, unknown>) => {
    const { config, def } = meta(c);
    const label = t(section, config.field);
    const key = sort.find((k) => k.field === config.field);
    const sortable = def !== undefined && def.type !== "json";
    const dir = key ? (key.dir ?? "asc") : null;
    const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ChevronsUpDown;
    const menu = schemaEdit && def !== undefined && props.onSchemaAction;
    const text = (
      <span className="flex min-w-0 items-baseline gap-0.5">
        <span className="truncate">{label}</span>
        {def?.required ? (
          // The star is CSS content, so the header's text stays the bare label.
          <span
            data-testid="required-marker"
            title={t("APP", "FORM_REQUIRED")}
            className="text-sem-danger after:content-['*']"
          />
        ) : null}
      </span>
    );
    return (
      <th
        key={c.id}
        scope="col"
        data-testid={`th-${config.field}`}
        data-required={def?.required || undefined}
        aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
        style={pinStyle(c)}
        className={cn(
          "group/th relative h-9 border-b border-border bg-muted p-0 text-left text-xs font-medium text-muted-foreground",
          pinClass(c),
          c.getIsPinned() ? "z-[15]" : "",
        )}
      >
        {sortable ? (
          <button
            type="button"
            data-testid={`sort-${config.field}`}
            onClick={(e) => props.onSort(config.field, e.shiftKey)}
            title={dir ? t("APP", dir === "asc" ? "SORT_ASC" : "SORT_DESC") : undefined}
            className={cn(
              "flex h-full w-full items-center gap-1 px-3 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
              alignClass(c),
              dir && "text-foreground",
            )}
          >
            {text}
            <Icon
              className={cn(
                "size-3.5 shrink-0 transition-opacity",
                dir ? "text-primary opacity-100" : "opacity-0 group-hover/th:opacity-60",
              )}
            />
          </button>
        ) : (
          <div className={cn("flex h-full items-center px-3", alignClass(c))}>{text}</div>
        )}
        {menu ? (
          <ColumnHeaderMenu
            field={config.field}
            label={label}
            onAction={menu}
            className="absolute top-1/2 right-1.5 -translate-y-1/2 bg-muted shadow-[-10px_0_8px_-2px_var(--muted)]"
          />
        ) : null}
      </th>
    );
  };

  const addColumnHeader = schemaEdit ? (
    <th
      key="__add"
      scope="col"
      className="h-9 border-r border-b border-border bg-muted p-0"
      style={{ width: ADD_COLUMN_WIDTH }}
    >
      <button
        type="button"
        data-testid="col-add-end"
        title={t("APP", "COL_ADD")}
        aria-label={t("APP", "COL_ADD")}
        onClick={() => props.onSchemaAction?.({ kind: "add", position: { where: "end" } })}
        className="grid h-full w-full place-items-center text-muted-foreground outline-none transition-colors hover:bg-hover hover:text-primary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <Plus className="size-4" />
      </button>
    </th>
  ) : null;
  const addColumnCell = (key: string, className: string) =>
    schemaEdit ? (
      <td key={key} aria-hidden className={cn("border-r border-b border-border p-0", className)} />
    ) : null;

  const filler = (key: string, className?: string) => (
    <td key={key} aria-hidden className={cn("p-0", className)} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={measureEdges}
        data-testid="table-scroll"
        className="scroll-thin relative min-h-0 flex-1 overflow-auto"
      >
        {data.isFetching && !data.isLoading && !isFetchingNextPage ? (
          <div className="pointer-events-none sticky top-0 left-0 z-30 h-0">
            <div className="h-0.5 w-full overflow-hidden bg-primary/15">
              <div className="h-full w-1/3 animate-[shimmer_1s_linear_infinite] bg-primary/70 [background-size:200%_100%]" />
            </div>
          </div>
        ) : null}
        <table
          data-testid="udc-table"
          aria-busy={data.isFetching}
          aria-rowcount={total}
          className="border-separate border-spacing-0 text-[13px]"
          style={{ width: totalWidth, minWidth: "100%", tableLayout: "fixed" }}
        >
          <colgroup>
            {[...left, ...center].map((c) => (
              <col key={c.id} style={{ width: c.getSize() }} />
            ))}
            {schemaEdit ? <col style={{ width: ADD_COLUMN_WIDTH }} /> : null}
            <col />
            {right.map((c) => (
              <col key={c.id} style={{ width: c.getSize() }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr>
              {[...left, ...center].map(header)}
              {addColumnHeader}
              <th aria-hidden className="border-b border-border bg-muted p-0" />
              {right.map(header)}
            </tr>
          </thead>
          <tbody>
            {showSkeleton
              ? Array.from({ length: SKELETON_ROWS }, (_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
                  <tr key={i} data-testid="skeleton-row" style={{ height: rowHeight }}>
                    {[...left, ...center].map((c, j) => (
                      <td
                        key={c.id}
                        style={pinStyle(c)}
                        className={cn("border-b border-border bg-surface px-3", pinClass(c))}
                      >
                        <Skeleton
                          className="h-3"
                          style={{ width: `${45 + ((i * 7 + j * 13) % 45)}%` }}
                        />
                      </td>
                    ))}
                    {addColumnCell("a", "bg-surface")}
                    {filler("f", "border-b border-border bg-surface")}
                    {right.map((c) => (
                      <td
                        key={c.id}
                        style={pinStyle(c)}
                        className={cn("border-b border-border bg-surface px-3", pinClass(c))}
                      >
                        <Skeleton className="h-3 w-2/3" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
            {table.getRowModel().rows.map((r) => {
              const row = r.original;
              const tone = resolveRowColor(row, view.row_color);
              const cell = (c: Column<Row, unknown>) => {
                const { config, def } = meta(c);
                const editable = canEdit(c);
                const id = `${row.__meta.id}:${c.id}`;
                const editing = edit?.rowId === row.__meta.id && edit.colId === c.id;
                const color = config.color ?? tone?.color;
                const bg = config.bg ?? tone?.bg;
                return (
                  <td
                    key={c.id}
                    data-cell={id}
                    data-testid={`cell-${config.field}`}
                    data-editable={editable || undefined}
                    tabIndex={editable ? 0 : undefined}
                    title={editable && !editing ? t("APP", "EDIT_HINT") : undefined}
                    onDoubleClick={
                      editable ? () => startEdit({ rowId: row.__meta.id, colId: c.id }) : undefined
                    }
                    onKeyDown={
                      editable && !editing
                        ? (e) => {
                            if (e.key === "Enter" || e.key === "F2") {
                              e.preventDefault();
                              startEdit({ rowId: row.__meta.id, colId: c.id });
                            }
                          }
                        : undefined
                    }
                    style={pinStyle(c)}
                    className={cn(
                      "relative border-b border-border px-3 align-middle outline-none",
                      bg && bg !== "default" ? BG_COLOR[bg] : "bg-surface group-hover/row:bg-hover",
                      color ? TEXT_COLOR[color] : "",
                      color === "info" || color === "accent" ? "font-medium" : "",
                      editable &&
                        "cursor-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset hover:shadow-[inset_0_0_0_1px_var(--border-strong)]",
                      pinClass(c),
                      // Above the next rows, so the validation message under the cell shows.
                      editing && "z-[25]",
                    )}
                  >
                    <div className={cn("flex min-w-0 items-center", alignClass(c))}>
                      {props.folder && config.field === props.folder.options.label_field ? (
                        <FolderEntry row={row} nav={props.folder}>
                          <CellValue
                            value={row[config.field]}
                            column={config}
                            def={def}
                            locale={locale}
                            intlLocale={intlLocale}
                          />
                        </FolderEntry>
                      ) : (
                        <CellValue
                          value={row[config.field]}
                          column={config}
                          def={def}
                          locale={locale}
                          intlLocale={intlLocale}
                        />
                      )}
                    </div>
                    {editing ? (
                      <CellEditor
                        def={def}
                        initial={row[config.field]}
                        saving={saving}
                        error={editError?.message ?? null}
                        errorSeq={editError?.seq ?? 0}
                        align={config.align}
                        onCommit={(raw, reason) => void commit(row, c, raw, reason)}
                        onCancel={() => {
                          setEdit(null);
                          setEditError(null);
                          focusCell({ rowId: row.__meta.id, colId: c.id });
                        }}
                      />
                    ) : null}
                  </td>
                );
              };
              return (
                <tr
                  key={r.id}
                  data-testid="row"
                  data-row-id={row.__meta.id}
                  className="group/row"
                  style={{ height: rowHeight }}
                >
                  {[...left, ...center].map(cell)}
                  {addColumnCell("a", "bg-surface group-hover/row:bg-hover")}
                  {filler("f", "border-b border-border bg-surface group-hover/row:bg-hover")}
                  {right.map(cell)}
                </tr>
              );
            })}
          </tbody>
        </table>

        {showError && data.error ? <ErrorState error={data.error} onRetry={data.refetch} /> : null}
        {showEmpty ? <EmptyState filtered={props.filtered} onClear={props.onClearFilters} /> : null}

        {mode === "infinite" && data.rows.length > 0 ? (
          <div
            data-testid="infinite-footer"
            className="sticky left-0 flex h-12 items-center justify-center gap-2 text-xs text-muted-foreground"
            style={{ width: scrollRef.current?.clientWidth }}
          >
            {isFetchingNextPage ? (
              <>
                <Spinner />
                {t("APP", "LOADING_MORE")}
              </>
            ) : hasNextPage ? null : (
              t("APP", "ALL_LOADED", { total: new Intl.NumberFormat(intlLocale).format(total) })
            )}
          </div>
        ) : null}
        <div ref={sentinelRef} data-testid="infinite-sentinel" className="h-px" />
      </div>

      {mode === "pages" && !showError && (data.total ?? 0) > 0 ? (
        <Pager
          page={props.page}
          limit={props.limit}
          total={data.total ?? 0}
          onPage={props.onPage}
        />
      ) : null}
    </div>
  );
}
