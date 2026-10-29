import type { FilterChipConfig, FilterNode, Row } from "@jsudc/core";
import { BookOpen, FileCode2, InfinityIcon, Rows3 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartWindowControl } from "../chart/ChartWindowControl";
import { useChartWindow } from "../chart/useChartWindow";
import { andWindow } from "../chart/window";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/misc";
import { Segmented } from "../components/ui/segmented";
import { schemaLabelTerms, tableSection, useI18n } from "../i18n/i18n";
import { humanize } from "../lib/utils";
import { rendererEntry, rendererTabs } from "../renderers/registry";
import type { FolderNav, RendererCount } from "../renderers/types";
import { useSchemaEditor } from "../schema-editor/useSchemaEditor";
import { ErrorState } from "../table/states";
import { useUdcCollection, useUdcDescribe } from "../udc/hooks";
import type { PagingMode } from "../udc/keys";
import { composeFilter } from "./compose";
import { DocTab } from "./DocTab";
import { FilePreview } from "./FilePreview";
import { FilterBuilder, FilterPills } from "./FilterBuilder";
import { FilterChips } from "./FilterChips";
import { FolderBar } from "./FolderBar";
import { Freshness } from "./Freshness";
import { joinFolder, splitFolder } from "./folder";
import { liveDescribe, liveSort, pruneTree } from "./liveView";
import { SearchBox } from "./SearchBox";
import { SourceTab } from "./SourceTab";
import { cycleSort } from "./urlState";
import { DOC_TAB, SOURCE_TAB, useDataViewState } from "./useDataViewState";

/**
 * One collection: toolbar (search, chips, filter builder, paging mode, count,
 * renderer tabs) over the active renderer. Everything the user picks lives
 * in the URL (see `useDataViewState`).
 */
export function UdcDataView({ collection }: { collection: string }) {
  const { t, tMaybe, locale, intlLocale, setSectionTerms } = useI18n();
  const describe = useUdcDescribe(collection);
  // Soft-deleted fields leave the chips, search, cards and any sort or filter in the URL.
  const live = useMemo(
    () => (describe.data ? liveDescribe(describe.data) : undefined),
    [describe.data],
  );
  const view = live?.view;
  const schema = live?.schema;
  // The README in the UI's language, else the English one.
  const docs: Partial<Record<string, string>> | undefined = live?.docs;
  const docText = docs?.[locale] ?? docs?.en;
  const hasSource = live?.capabilities.source_yaml === true;
  const state = useDataViewState(collection, view, { doc: Boolean(docText), source: hasSource });
  // The README and the source file are pages of their own: no rows, no toolbar.
  const onSource = state.tab === SOURCE_TAB;
  const onDoc = state.tab === DOC_TAB;
  const onPage = onDoc || onSource;
  const section = tableSection(collection);

  // Labels typed in the field form live in the schema; the headers read them through i18n.
  useEffect(() => {
    if (schema) setSectionTerms(section, schemaLabelTerms(schema));
  }, [schema, section, setSectionTerms]);

  const sort = useMemo(
    () => (schema ? liveSort(state.sort, schema) : state.sort),
    [state.sort, schema],
  );
  const tree = useMemo(
    () => (schema ? pruneTree(state.tree, schema) : state.tree),
    [state.tree, schema],
  );

  // A folder listing: the open folder is a condition of the tree, shown as the breadcrumb
  // instead of a filter pill; the builder and the pills edit the rest of the tree.
  const folderOpts = view?.folder_options;
  const { folder, rest: userTree } = useMemo(
    () => (folderOpts ? splitFolder(tree, folderOpts.path_field) : { folder: null, rest: tree }),
    [tree, folderOpts],
  );
  const { setTree } = state;
  const setUserTree = useCallback(
    (next: FilterNode | null) =>
      setTree(folderOpts ? joinFolder(next, folderOpts.path_field, folder) : next),
    [setTree, folderOpts, folder],
  );
  const [previewRow, setPreviewRow] = useState<Row | null>(null);
  const folderNav = useMemo<FolderNav | undefined>(
    () =>
      folderOpts
        ? {
            options: folderOpts,
            open: (path) => setTree(joinFolder(userTree, folderOpts.path_field, path || null)),
            openFile: folderOpts.preview ? setPreviewRow : undefined,
          }
        : undefined,
    [folderOpts, userTree, setTree],
  );

  const userFilter = useMemo(
    () =>
      composeFilter({
        search: state.search,
        searchConfig: view?.search,
        chips: state.chips,
        chipConfigs: view?.filters,
        tree,
      }),
    [state.search, state.chips, tree, view?.search, view?.filters],
  );
  const userBaseFilter = useMemo(
    () =>
      composeFilter({
        search: "",
        searchConfig: view?.search,
        chips: state.chips,
        chipConfigs: view?.filters,
        tree,
      }),
    [state.chips, tree, view?.search, view?.filters],
  );

  // A chart window applies on the chart tab (its default preset), and on every tab of the view
  // once the URL picked one, so the table shows the rows the chart draws.
  const win = useChartWindow(view);
  const onChart = state.tab === "chart";
  const chartWindow = win && !onPage && (onChart || win.explicit) ? win : undefined;
  const windowCond = chartWindow?.cond;
  const filter = useMemo(() => andWindow(userFilter, windowCond), [userFilter, windowCond]);
  const baseFilter = useMemo(
    () => andWindow(userBaseFilter, windowCond),
    [userBaseFilter, windowCond],
  );

  const entry = onPage ? undefined : rendererEntry(state.tab);
  const paging = !onPage && (entry?.paging ?? true);
  // A renderer without paging loads its own rows; the count it reports replaces the list's.
  const [ownCount, setOwnCount] = useState<RendererCount | null>(null);

  const limit = view?.page_size_default ?? 50;
  const data = useUdcCollection({
    collection,
    filter,
    sort,
    mode: state.mode,
    pageLimit: limit,
    page: state.page,
    enabled: describe.isSuccess && paging,
    capabilities: live?.capabilities,
    refetchInterval: view?.refresh_interval_ms,
  });

  const fieldLabel = useCallback((field: string) => t(section, field), [t, section]);
  const chipLabel = useCallback(
    (cfg: FilterChipConfig) => tMaybe(section, cfg.field) ?? cfg.label ?? humanize(cfg.field),
    [tMaybe, section],
  );
  const { setSearch } = state;
  const onSearch = useCallback((q: string) => setSearch(q), [setSearch]);
  const editor = useSchemaEditor({ collection, schema, fieldLabel });

  const title = t("COLLECTIONS", collection);
  const description = tMaybe(section, "__DESCRIPTION");

  if (describe.error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState error={describe.error} onRetry={() => void describe.refetch()} />
      </div>
    );
  }

  // The window is not a filter the user can clear: "clear filters" leaves it.
  const filtered = userFilter !== undefined;
  const fmt = (n: number) => new Intl.NumberFormat(intlLocale).format(n);
  const shown = paging ? data.rows.length : (ownCount?.shown ?? 0);
  const total = paging ? data.total : (ownCount?.total ?? null);
  const fetchedAt = paging ? data.fetchedAt : (ownCount?.fetchedAt ?? null);
  const stale = paging ? data.stale : ownCount?.stale === true;
  const tabs = view
    ? [
        ...(docText ? [{ name: DOC_TAB, entry: undefined, doc: true }] : []),
        ...rendererTabs(view.available_renderers).map((tab) => ({ ...tab, doc: false })),
        ...(hasSource ? [{ name: SOURCE_TAB, entry: undefined, doc: true }] : []),
      ]
    : [];
  const resetKey = JSON.stringify([filter ?? null, sort, state.mode]);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-testid="data-view"
      data-collection={collection}
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2 px-6 pt-5 pb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          {description ? <p className="text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {view && paging ? (
            <Segmented<PagingMode>
              aria-label={t("APP", "PAGING")}
              data-testid="paging-toggle"
              value={state.mode}
              onChange={state.setMode}
              options={[
                {
                  value: "pages",
                  testId: "paging-pages",
                  label: (
                    <>
                      <Rows3 />
                      {t("APP", "PAGING_PAGES")}
                    </>
                  ),
                },
                {
                  value: "infinite",
                  testId: "paging-infinite",
                  label: (
                    <>
                      <InfinityIcon />
                      {t("APP", "PAGING_INFINITE")}
                    </>
                  ),
                },
              ]}
            />
          ) : null}
          {view && paging && tabs.length > 1 ? (
            <span aria-hidden className="mx-1 h-5 w-px bg-border-strong/70" />
          ) : null}
          {view && tabs.length > 1 ? (
            <Segmented
              aria-label="Renderer"
              data-testid="tab-switch"
              value={state.tab}
              onChange={state.setTab}
              options={tabs.map(({ name, entry: e, doc }) => {
                if (doc) {
                  const PageIcon = name === SOURCE_TAB ? FileCode2 : BookOpen;
                  return {
                    value: name,
                    testId: `tab-${name}`,
                    label: (
                      <>
                        <PageIcon />
                        {t("APP", name === SOURCE_TAB ? "TAB_SOURCE" : "TAB_DOC")}
                      </>
                    ),
                  };
                }
                const Icon = e?.icon;
                return {
                  value: name,
                  testId: `tab-${name}`,
                  disabled: e === undefined,
                  ...(e ? {} : { tooltip: t("APP", "TAB_UNAVAILABLE", { name }) }),
                  label: (
                    <>
                      {Icon ? <Icon /> : null}
                      {e ? t("APP", e.labelKey) : (tMaybe("APP", `TAB_${name}`) ?? humanize(name))}
                    </>
                  ),
                };
              })}
            />
          ) : null}
        </div>
      </header>

      <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.03]">
        <div
          data-testid="toolbar"
          className={
            onPage
              ? "hidden"
              : "flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5"
          }
        >
          {view ? (
            <>
              {/* A view without a `search` block has nothing to search: no box. */}
              {view.search ? (
                <SearchBox
                  value={state.search}
                  onChange={onSearch}
                  placeholder={
                    tMaybe(section, "SEARCH_PLACEHOLDER") ??
                    view.search.placeholder ??
                    t("APP", "SEARCH")
                  }
                />
              ) : null}
              {/* Its natural width: on a narrow screen the chips wrap as one group, under the search. */}
              <div className="flex flex-wrap items-center gap-1.5">
                {view.filters?.length ? (
                  <FilterChips
                    configs={view.filters}
                    state={state.chips}
                    onChange={state.setChips}
                    label={chipLabel}
                  />
                ) : null}
                {live?.filterable.fields.length ? (
                  <FilterBuilder
                    fields={live.filterable.fields}
                    tree={userTree}
                    onChange={setUserTree}
                    fieldLabel={fieldLabel}
                  />
                ) : null}
              </div>
              <div className="ml-auto flex items-center gap-2">
                {entry?.toolbar && live ? (
                  <entry.toolbar collection={collection} describe={live} />
                ) : null}
                {chartWindow ? <ChartWindowControl win={chartWindow} clearable={!onChart} /> : null}
                <Freshness fetchedAt={fetchedAt} stale={stale} source={live?.source} />
                <span
                  className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                  data-testid="row-count"
                  data-shown={shown}
                  data-total={total ?? undefined}
                >
                  {total === null ? (
                    <Skeleton className="h-3 w-24" />
                  ) : ownCount?.unit === "nodes" && !paging ? (
                    shown === total ? (
                      t("APP", "TREE_NODES", { count: fmt(total) })
                    ) : (
                      t("APP", "TREE_NODES_OF", { shown: fmt(shown), total: fmt(total) })
                    )
                  ) : ownCount?.unit === "map" && !paging ? (
                    t("APP", "MAP_ON_MAP", { shown: fmt(shown), total: fmt(total) })
                  ) : ownCount?.unit === "chart" && !paging ? (
                    t("APP", "CHART_IN_WINDOW", { shown: fmt(shown), total: fmt(total) })
                  ) : (
                    t("APP", "SHOWING", { shown: fmt(shown), total: fmt(total) })
                  )}
                </span>
              </div>
            </>
          ) : (
            <>
              <Skeleton className="h-8 w-80" />
              <Skeleton className="h-7 w-20 rounded-full" />
              <Skeleton className="h-7 w-24 rounded-full" />
            </>
          )}
        </div>

        {live && userTree && !onPage ? (
          <div
            data-testid="filter-pills"
            className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2"
          >
            <FilterPills
              fields={live.filterable.fields}
              tree={userTree}
              onChange={setUserTree}
              fieldLabel={fieldLabel}
            />
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setUserTree(null)}>
              {t("APP", "CLEAR")}
            </Button>
          </div>
        ) : null}

        {folderNav && !onPage ? <FolderBar folder={folder} onOpen={folderNav.open} /> : null}

        {live && onDoc && docText ? (
          <DocTab markdown={docText} />
        ) : live && onSource ? (
          <SourceTab collection={collection} />
        ) : live && entry ? (
          <entry.component
            key={state.tab}
            collection={collection}
            describe={live}
            data={data}
            filter={filter}
            baseFilter={baseFilter}
            chartWindow={chartWindow}
            unwindowedFilter={userFilter}
            search={state.search}
            sort={sort}
            onSort={(field, multi) => state.setSort(cycleSort(sort, field, multi))}
            mode={state.mode}
            page={state.page}
            limit={limit}
            onPage={state.setPage}
            filtered={filtered}
            onClearFilters={state.clearFilters}
            resetKey={resetKey}
            onSchemaAction={
              entry.editMode && live.capabilities.schema_edit ? editor.open : undefined
            }
            onCount={setOwnCount}
            folder={folderNav}
          />
        ) : (
          <div className="flex flex-col gap-3 p-4">
            {Array.from({ length: 10 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: placeholders
              <Skeleton key={i} className="h-6" />
            ))}
          </div>
        )}
      </div>
      {editor.dialogs}
      {folderOpts?.preview ? (
        <FilePreview
          collection={collection}
          row={previewRow}
          pathField={folderOpts.path_field}
          onClose={() => setPreviewRow(null)}
        />
      ) : null}
    </div>
  );
}
