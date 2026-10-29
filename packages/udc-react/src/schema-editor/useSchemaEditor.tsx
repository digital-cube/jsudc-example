import type { SchemaDoc } from "@jsudc/core";
import { type ReactNode, useCallback, useState } from "react";
import { Dialog } from "../components/ui/dialog";
import { useToast } from "../components/ui/toast";
import { useI18n } from "../i18n/i18n";
import { DeleteFieldDialog } from "./DeleteFieldDialog";
import { FieldFormDialog } from "./FieldFormDialog";
import type { SchemaAction } from "./fieldForm";

/** Bring a header into view once its column exists (it appears after `describe` refetched). */
function revealColumn(field: string) {
  let tries = 0;
  const step = () => {
    const th = document.querySelector<HTMLElement>(`[data-testid="th-${CSS.escape(field)}"]`);
    if (th) th.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    else if (tries++ < 30) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/**
 * The schema editor of one collection: `open(action)` from a column menu or
 * the trailing `+`, and the dialogs to render somewhere in the tree.
 */
export function useSchemaEditor({
  collection,
  schema,
  fieldLabel,
}: {
  collection: string;
  schema: SchemaDoc | undefined;
  fieldLabel: (field: string) => string;
}): { open: (a: SchemaAction) => void; dialogs: ReactNode } {
  const { t } = useI18n();
  const { toast } = useToast();
  const [action, setAction] = useState<SchemaAction | null>(null);
  const [seq, setSeq] = useState(0);

  const open = useCallback((a: SchemaAction) => {
    setAction(a);
    setSeq((n) => n + 1);
  }, []);
  const close = () => setAction(null);

  let content: ReactNode = null;
  if (action && schema) {
    if (action.kind === "delete") {
      const label = fieldLabel(action.field);
      content = (
        <DeleteFieldDialog
          key={seq}
          collection={collection}
          field={action.field}
          label={label}
          onCancel={close}
          onDeleted={() => {
            close();
            toast({ variant: "success", title: t("APP", "TOAST_DELETED", { label }) });
          }}
        />
      );
    } else {
      content = (
        <FieldFormDialog
          key={seq}
          collection={collection}
          schema={schema}
          target={
            action.kind === "add"
              ? { mode: "add", position: action.position }
              : { mode: "edit", field: action.field }
          }
          fieldLabel={fieldLabel}
          onCancel={close}
          onSaved={(name, label) => {
            close();
            toast({
              variant: "success",
              title: t("APP", action.kind === "add" ? "TOAST_ADDED" : "TOAST_UPDATED", { label }),
            });
            if (action.kind === "add") revealColumn(name);
          }}
        />
      );
    }
  }

  return {
    open,
    dialogs: (
      <Dialog open={content !== null} onOpenChange={(o) => !o && close()}>
        {content}
      </Dialog>
    ),
  };
}
