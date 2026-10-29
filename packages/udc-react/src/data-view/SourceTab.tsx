import { FileCode2, TriangleAlert } from "lucide-react";
import { Skeleton } from "../components/ui/misc";
import { useI18n } from "../i18n/i18n";
import { formatDateTime } from "../table/cells";
import { ErrorState } from "../table/states";
import { useTimezone } from "../time/timezone";
import { useUdcSource } from "../udc/hooks";

/**
 * The file a `source_yaml` collection is read from, as written: its path
 * and modification time over the text, with line numbers. When the file
 * no longer parses the server keeps serving the last good read; the reason
 * is shown above the text.
 */
export function SourceTab({ collection }: { collection: string }) {
  const { t, intlLocale } = useI18n();
  const { timeZone } = useTimezone();
  const source = useUdcSource(collection);

  if (source.error) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <ErrorState error={source.error} onRetry={() => void source.refetch()} />
      </div>
    );
  }
  const data = source.data;
  const lines = data ? data.text.replace(/\n$/, "").split("\n") : [];
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="source-tab">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2.5 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-foreground">
          <FileCode2 className="size-3.5 text-muted-foreground" aria-hidden />
          {data ? (
            <code data-testid="source-path" className="font-mono">
              {data.path}
            </code>
          ) : (
            <Skeleton className="h-3 w-40" />
          )}
        </span>
        {data ? (
          <span
            className="text-muted-foreground"
            data-testid="source-mtime"
            data-mtime={data.mtime}
          >
            {t("APP", "SOURCE_MODIFIED", {
              when: formatDateTime(data.mtime, intlLocale, timeZone),
            })}
          </span>
        ) : null}
        {data ? (
          <span className="ml-auto text-muted-foreground tabular-nums">
            {t("APP", "SOURCE_LINES", { count: lines.length })}
          </span>
        ) : null}
      </div>
      {data?.error ? (
        <div
          data-testid="source-error"
          className="flex items-start gap-2 border-b border-border bg-sem-warning-bg px-4 py-2 text-xs text-foreground"
        >
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          <div>
            <div className="font-medium">{t("APP", "SOURCE_STALE")}</div>
            <pre className="mt-1 font-mono whitespace-pre-wrap text-muted-foreground">
              {data.error}
            </pre>
          </div>
        </div>
      ) : null}
      <div className="scroll-thin min-h-0 flex-1 overflow-auto bg-muted/40">
        {data ? (
          <pre
            data-testid="source-text"
            className="min-w-max py-3 font-mono text-[12.5px] leading-5 text-foreground"
          >
            {lines.map((line, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: a line is its number
              <div key={i} className="flex">
                <span
                  aria-hidden
                  className="w-12 shrink-0 pr-4 text-right text-muted-foreground/60 select-none tabular-nums"
                >
                  {i + 1}
                </span>
                <code className={line.trimStart().startsWith("#") ? "text-muted-foreground" : ""}>
                  {line || " "}
                </code>
              </div>
            ))}
          </pre>
        ) : (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        )}
      </div>
    </div>
  );
}
