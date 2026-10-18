import type { FilterChipConfig } from "@jsudc/udc-core";
import { InfinityIcon, LayoutGrid, Rows3, Table2 } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/misc";
import { Segmented } from "../components/ui/segmented";
import { tableSection, useI18n } from "../i18n/i18n";
import { humanize } from "../lib/utils";
import { ErrorState } from "../table/states";
import { TableRenderer } from "../table/TableRenderer";
import { useUdcCollection, useUdcDescribe } from "../udc/hooks";
import type { PagingMode } from "../udc/keys";
import { composeFilter } from "./compose";
import { FilterBuilder, FilterPills } from "./FilterBuilder";
import { FilterChips } from "./FilterChips";
import { SearchBox } from "./SearchBox";
import { cycleSort } from "./urlState";
import { useDataViewState } from "./useDataViewState";

/**
 * One collection: toolbar (search, chips, filter builder, paging mode, count,
 * renderer tabs) over the active renderer. Everything the user picks lives
 * in the URL (see `useDataViewState`).
 */
export function UdcDataView({ collection }: { collection: string }) {
  const { t, tMaybe, intlLocale } = useI18n();
  const describe = useUdcDescribe(collection);
  const view = describe.data?.view;
  const state = useDataViewState(collection, view);
  const section = tableSection(collection);

  const filter = useMemo(
    () =>
      composeFilter({
        search: state.search,
        searchConfig: view?.search,
        chips: state.chips,
        chipConfigs: view?.filters,
        tree: state.tree,
      }),
    [state.search, state.chips, state.tree, view?.search, view?.filters],
  );

  const limit = view?.page_size_default ?? 50;
  const data = useUdcCollection({
    collection,
    filter,
    sort: state.sort,
    mode: state.mode,
    pageLimit: limit,
    page: state.page,
    enabled: describe.isSuccess,
  });

  const fieldLabel = useCallback((field: string) => t(section, field), [t, section]);
  const chipLabel = useCallback(
    (cfg: FilterChipConfig) => tMaybe(section, cfg.field) ?? cfg.label ?? humanize(cfg.field),
    [tMaybe, section],
  );
  const { setSearch } = state;
  const onSearch = useCallback((q: string) => setSearch(q), [setSearch]);

  const title = t("COLLECTIONS", collection);
  const description = tMaybe(section, "__DESCRIPTION");

  if (describe.error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <ErrorState error={describe.error} onRetry={() => void describe.refetch()} />
      </div>
    );
  }

  const filtered = filter !== undefined;
  const fmt = (n: number) => new Intl.NumberFormat(intlLocale).format(n);
  const total = data.total;
  const resetKey = JSON.stringify([filter ?? null, state.sort, state.mode]);

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
        {view && view.available_renderers.length > 1 ? (
          <Segmented
            aria-label="Renderer"
            data-testid="tab-switch"
            value={state.tab}
            onChange={state.setTab}
            options={view.available_renderers.map((r) => ({
              value: r,
              testId: `tab-${r}`,
              label: (
                <>
                  {r === "cards" ? <LayoutGrid /> : <Table2 />}
                  {t("APP", `TAB_${r}`)}
                </>
              ),
            }))}
          />
        ) : null}
      </header>

      <div className="mx-6 mb-6 flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-sm shadow-black/[0.03]">
        <div
          data-testid="toolbar"
          className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2.5"
        >
          {view ? (
            <>
              <SearchBox
                value={state.search}
                onChange={onSearch}
                placeholder={
                  tMaybe(section, "SEARCH_PLACEHOLDER") ??
                  view.search?.placeholder ??
                  t("APP", "SEARCH")
                }
              />
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                {view.filters?.length ? (
                  <FilterChips
                    configs={view.filters}
                    state={state.chips}
                    onChange={state.setChips}
                    label={chipLabel}
                  />
                ) : null}
                {describe.data?.filterable.fields.length ? (
                  <FilterBuilder
                    fields={describe.data.filterable.fields}
                    tree={state.tree}
                    onChange={state.setTree}
                    fieldLabel={fieldLabel}
                  />
                ) : null}
              </div>
              <div className="ml-auto flex items-center gap-3">
                <span
                  className="text-xs whitespace-nowrap text-muted-foreground tabular-nums"
                  data-testid="row-count"
                  data-shown={data.rows.length}
                  data-total={total ?? undefined}
                >
                  {total === null ? (
                    <Skeleton className="h-3 w-24" />
                  ) : (
                    t("APP", "SHOWING", { shown: fmt(data.rows.length), total: fmt(total) })
                  )}
                </span>
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

        {describe.data && state.tree ? (
          <div
            data-testid="filter-pills"
            className="flex flex-wrap items-center gap-1.5 border-b border-border bg-muted/40 px-3 py-2"
          >
            <FilterPills
              fields={describe.data.filterable.fields}
              tree={state.tree}
              onChange={state.setTree}
              fieldLabel={fieldLabel}
            />
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => state.setTree(null)}
            >
              {t("APP", "CLEAR")}
            </Button>
          </div>
        ) : null}

        {describe.data && state.tab === "cards" ? (
          <CardsPlaceholder />
        ) : describe.data ? (
          <TableRenderer
            collection={collection}
            describe={describe.data}
            data={data}
            mode={state.mode}
            page={state.page}
            limit={limit}
            onPage={state.setPage}
            sort={state.sort}
            onSort={(field, multi) => state.setSort(cycleSort(state.sort, field, multi))}
            filtered={filtered}
            onClearFilters={state.clearFilters}
            resetKey={resetKey}
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
    </div>
  );
}

function CardsPlaceholder() {
  const { t } = useI18n();
  return (
    <div
      data-testid="cards-placeholder"
      className="flex flex-1 flex-col items-center justify-center p-12 text-center"
    >
      <div className="mb-4 grid grid-cols-3 gap-2 opacity-70">
        {Array.from({ length: 6 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: decoration
          <div key={i} className="h-12 w-16 rounded-lg border border-border bg-muted" />
        ))}
      </div>
      <div className="text-sm font-semibold">{t("APP", "CARDS_SOON_TITLE")}</div>
      <div className="mt-1 max-w-sm text-[13px] text-muted-foreground">
        {t("APP", "CARDS_SOON_BODY")}
      </div>
    </div>
  );
}
