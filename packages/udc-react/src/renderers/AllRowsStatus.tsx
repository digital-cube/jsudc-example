import { useI18n } from "../i18n/i18n";
import type { UdcAllRowsResult } from "../udc/hooks";

/**
 * What a renderer over `useUdcAllRows` shows above its content: a thin bar
 * filling while the pages load, and a notice when the cap cut the rows short.
 */
export function AllRowsStatus({ result }: { result: UdcAllRowsResult }) {
  const { t, intlLocale } = useI18n();
  const fmt = (n: number) => new Intl.NumberFormat(intlLocale).format(n);
  const { progress } = result;
  const pct = progress?.total ? Math.min(100, (progress.loaded / progress.total) * 100) : null;
  return (
    <>
      {result.isFetching ? (
        <div className="pointer-events-none relative z-30 h-0" data-testid="all-rows-progress">
          <div className="h-0.5 w-full overflow-hidden bg-primary/15">
            {pct === null ? (
              <div className="h-full w-1/3 animate-[shimmer_1s_linear_infinite] bg-primary/70" />
            ) : (
              <div
                className="h-full bg-primary/70 transition-[width]"
                style={{ width: `${pct}%` }}
              />
            )}
          </div>
        </div>
      ) : null}
      {result.capped && result.total !== null ? (
        <div
          data-testid="all-rows-capped"
          className="border-b border-border bg-sem-warning-bg px-4 py-1.5 text-xs text-sem-warning"
        >
          {t("APP", "CAPPED", { shown: fmt(result.rows.length), total: fmt(result.total) })}
        </div>
      ) : null}
    </>
  );
}
