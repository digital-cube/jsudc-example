import { AlertTriangle, RotateCw, SearchX, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../components/ui/button";
import { useI18n } from "../i18n/i18n";

function Panel({
  icon,
  title,
  body,
  action,
  testId,
  tone = "muted",
}: {
  icon: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
  testId: string;
  tone?: "muted" | "danger";
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center px-6 py-16 text-center">
      <div
        className={
          tone === "danger"
            ? "mb-4 grid size-12 place-items-center rounded-xl bg-sem-danger-bg text-sem-danger"
            : "mb-4 grid size-12 place-items-center rounded-xl border border-border bg-muted text-muted-foreground"
        }
      >
        {icon}
      </div>
      <div className="text-sm font-semibold">{title}</div>
      {body ? <div className="mt-1 max-w-sm text-[13px] text-muted-foreground">{body}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** `body` replaces the default text (a view's `empty_label`). */
export function EmptyState({
  filtered,
  onClear,
  body,
}: {
  filtered: boolean;
  onClear: () => void;
  body?: string | undefined;
}) {
  const { t } = useI18n();
  return filtered ? (
    <Panel
      testId="table-empty"
      icon={<SearchX className="size-5" />}
      title={t("APP", "EMPTY_TITLE")}
      body={body ?? t("APP", "EMPTY_BODY")}
      action={
        <Button size="sm" onClick={onClear}>
          {t("APP", "CLEAR_FILTERS")}
        </Button>
      }
    />
  ) : (
    <Panel
      testId="table-empty"
      icon={<Table2 className="size-5" />}
      title={t("APP", "EMPTY_TITLE")}
      body={body ?? t("APP", "EMPTY_PLAIN")}
    />
  );
}

export function ErrorState({ error, onRetry }: { error: Error; onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <Panel
      testId="table-error"
      tone="danger"
      icon={<AlertTriangle className="size-5" />}
      title={t("APP", "ERROR_TITLE")}
      body={<span className="font-mono text-xs">{error.message}</span>}
      action={
        <Button size="sm" onClick={onRetry} data-testid="retry">
          <RotateCw className="size-3.5!" />
          {t("APP", "RETRY")}
        </Button>
      }
    />
  );
}
