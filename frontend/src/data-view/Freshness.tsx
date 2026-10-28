import { CloudOff, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Tip } from "../components/ui/tooltip";
import { useI18n } from "../i18n/i18n";
import { cn } from "../lib/utils";

/** "12 s ago", "3 min ago", "pre 12 s": the age of a fetched copy. */
export function ageText(fetchedAt: string, now: number, intlLocale: string): string {
  const s = Math.max(0, Math.round((now - Date.parse(fetchedAt)) / 1000));
  const rtf = new Intl.RelativeTimeFormat(intlLocale, { numeric: "always", style: "short" });
  if (s < 60) return rtf.format(-s, "second");
  if (s < 3600) return rtf.format(-Math.floor(s / 60), "minute");
  return rtf.format(-Math.floor(s / 3600), "hour");
}

/**
 * For a source that serves a fetched copy (http_api): how old the copy is,
 * ticking, and a warning pill when the last refresh failed and the copy is
 * stale. Nothing for a live source.
 */
export function Freshness({ fetchedAt, stale }: { fetchedAt: string | null; stale: boolean }) {
  const { t, intlLocale } = useI18n();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!fetchedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [fetchedAt]);
  if (!fetchedAt) return null;
  return (
    <span className="flex items-center gap-1.5">
      {stale ? (
        <Tip label={t("APP", "STALE_HINT")}>
          <span
            data-testid="stale-pill"
            className="inline-flex h-5 items-center gap-1 rounded-full bg-sem-warning-bg px-2 text-[11px] font-medium text-sem-warning"
          >
            <CloudOff className="size-3" />
            {t("APP", "STALE")}
          </span>
        </Tip>
      ) : null}
      <span
        data-testid="updated-ago"
        data-fetched-at={fetchedAt}
        title={new Date(fetchedAt).toLocaleString(intlLocale)}
        className={cn(
          "inline-flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums",
        )}
      >
        <RefreshCw className="size-3" />
        {t("APP", "UPDATED_AGO", { age: ageText(fetchedAt, now, intlLocale) })}
      </span>
    </span>
  );
}
