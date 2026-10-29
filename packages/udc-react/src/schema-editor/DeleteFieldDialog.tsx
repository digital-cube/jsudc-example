import { isUdcError } from "@jsudc/core";
import { AlertTriangle, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { DialogBody, DialogContent, DialogFooter } from "../components/ui/dialog";
import { Spinner } from "../components/ui/misc";
import { useI18n } from "../i18n/i18n";
import { useUdcSchema } from "../udc/hooks";

/** Confirms a soft delete: the column goes, the data stays. */
export function DeleteFieldDialog({
  collection,
  field,
  label,
  onDeleted,
  onCancel,
}: {
  collection: string;
  field: string;
  label: string;
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { softDeleteField } = useUdcSchema(collection);
  const [error, setError] = useState<string | null>(null);
  const pending = softDeleteField.isPending;

  const confirm = async () => {
    setError(null);
    try {
      await softDeleteField.mutateAsync(field);
      onDeleted();
    } catch (err) {
      setError(isUdcError(err) || err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <DialogContent
      role="alertdialog"
      data-testid="delete-field"
      title={t("APP", "DELETE_TITLE", { label })}
      onEscapeKeyDown={(e) => pending && e.preventDefault()}
      onInteractOutside={(e) => pending && e.preventDefault()}
    >
      <DialogBody className="flex gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sem-danger-bg text-sem-danger">
          <Trash2 className="size-4" />
        </span>
        <div className="min-w-0 text-[13px] text-muted-foreground">
          <p data-testid="delete-field-body">{t("APP", "DELETE_BODY")}</p>
          <p className="mt-2">
            {t("APP", "DELETE_FIELD_NAME")}{" "}
            <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
              {field}
            </code>
          </p>
          {error ? (
            <p
              role="alert"
              data-testid="delete-field-error"
              className="mt-3 flex items-start gap-1.5 text-sem-danger"
            >
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
              {error}
            </p>
          ) : null}
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel} disabled={pending}>
          {t("APP", "CANCEL")}
        </Button>
        <Button
          variant="danger"
          data-testid="delete-field-confirm"
          onClick={() => void confirm()}
          disabled={pending}
        >
          {pending ? <Spinner /> : null}
          {t("APP", "DELETE_CONFIRM")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
