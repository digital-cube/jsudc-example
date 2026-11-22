import { type CellProps, createCellRegistry, useI18n } from "@jsudc/react";

/**
 * `render: unread_dot` (backend/collections/mail_messages/view.yaml): the
 * `seen` flag drawn as the mailbox draws it, a dot for an unread message and
 * nothing for a read one. A cell of the example's own, registered by name
 * like a renderer; the table and the cards resolve it before the built-in
 * kinds.
 */
export function UnreadDotCell({ value, surface }: CellProps) {
  const { t } = useI18n();
  const unread = value === false;
  return (
    <span
      data-testid="unread-dot"
      data-unread={unread ? "true" : "false"}
      className="inline-flex w-full items-center justify-center"
      title={unread ? t("MAIL", "UNREAD") : undefined}
    >
      {unread ? (
        <span
          role="img"
          aria-label={t("MAIL", "UNREAD")}
          className={
            surface === "card"
              ? "size-2 rounded-full bg-primary"
              : "size-2.5 rounded-full bg-primary shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_18%,transparent)]"
          }
        />
      ) : null}
    </span>
  );
}

/** Every cell the example registers, handed to `UdcProvider cells` (src/App.tsx). */
export const EXAMPLE_CELLS = createCellRegistry({ name: "unread_dot", component: UnreadDotCell });
