import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { Row } from "@jsudc/core";
import { ChevronRight, CornerLeftUp, MoreVertical } from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Spinner } from "../components/ui/misc";
import { Tip } from "../components/ui/tooltip";
import { useI18n } from "../i18n/i18n";
import { resolveIcon } from "../icons/resolve";
import { cn } from "../lib/utils";
import { canDrop, dropId, highlightParts, i18nKey, idOf, numberOf } from "./model";
import { LazyChildren, NodeList, useTree } from "./TreeRenderer";

const INDENT = 20;

/** The label as text: `label_i18n` reads `<SECTION>_<TERM>` through `t`, else the raw value. */
function useLabel(row: Row): string {
  const { tMaybe } = useI18n();
  const { opts } = useTree();
  const raw = row[opts.label_field];
  const text = raw === null || raw === undefined ? "" : String(raw);
  const key = opts.label_i18n ? i18nKey(text) : null;
  return (key && tMaybe(key[0], key[1])) || text || "—";
}

/** The label with the search term marked. */
export function TreeNodeLabel({ row }: { row: Row }) {
  const { term } = useTree();
  const label = useLabel(row);
  return (
    <span>
      {highlightParts(label, term).map((p) =>
        p.match ? (
          <mark
            key={p.at}
            data-testid="tree-highlight"
            className="rounded-sm bg-sem-warning-bg px-0.5 text-foreground"
          >
            {p.text}
          </mark>
        ) : (
          <span key={p.at}>{p.text}</span>
        ),
      )}
    </span>
  );
}

/** Move the focus to the previous / next row on screen, or to the row with `id`. */
function focusRow(from: HTMLElement, where: -1 | 1 | string) {
  const tree = from.closest('[role="tree"]');
  if (!tree) return;
  const rows = [...tree.querySelectorAll<HTMLElement>("[data-tree-row]")];
  const target =
    typeof where === "string"
      ? rows.find((r) => r.dataset.id === where)
      : rows[rows.indexOf(from) + where];
  target?.focus();
}

export function TreeNode({ row, depth }: { row: Row; depth: number }) {
  const { t } = useI18n();
  const ctx = useTree();
  const { opts, lazy, can, drag } = ctx;
  const id = idOf(row);
  const label = useLabel(row);
  const built = lazy ? [] : ctx.childrenOf(id);
  const count = opts.children_count_field
    ? (numberOf(row, opts.children_count_field) ?? 0)
    : built.length;
  const movedIn = [...ctx.moved.values()].some((m) => m.parent === id);
  const hasChildren = lazy ? count > 0 || movedIn : built.length > 0;
  const open = hasChildren && ctx.isOpen(id, depth);
  const orphan = ctx.orphans.has(id);

  const [renaming, setRenaming] = useState(false);
  const [replying, setReplying] = useState(false);

  // Drag and drop: the row is draggable and a drop target ("into"); a strip above it is the gap.
  const draggable = useDraggable({ id, disabled: !can.reparent || renaming });
  const into = { kind: "into", id } as const;
  const before = { kind: "before", id } as const;
  const intoOk = drag !== null && canDrop(drag.id, into, drag.rowsById, opts);
  const beforeOk = drag !== null && canDrop(drag.id, before, drag.rowsById, opts);
  const dropInto = useDroppable({ id: dropId(into), disabled: !intoOk });
  const dropBefore = useDroppable({ id: dropId(before), disabled: !beforeOk });
  const dragging = drag?.id === id;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const el = e.currentTarget;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(el, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      if (hasChildren && !open) ctx.setOpen(id, true);
      else if (open) focusRow(el, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const parent = row[opts.parent_field];
      if (open) ctx.setOpen(id, false);
      else if (typeof parent === "string") focusRow(el, parent);
    } else if (e.key === "Enter") {
      e.preventDefault();
      ctx.onOpenDetail(row);
    } else if (e.key === "F2" && can.rename) {
      e.preventDefault();
      setRenaming(true);
    }
  };

  const avatar = opts.avatar_field ? row[opts.avatar_field] : undefined;
  const iconName = opts.icon_field ? row[opts.icon_field] : undefined;
  const Icon = resolveIcon(iconName);
  const path = opts.path_field ? row[opts.path_field] : undefined;
  const menu = [
    { key: "details", label: t("APP", "TREE_DETAILS"), run: () => ctx.onOpenDetail(row) },
    ...(can.rename
      ? [{ key: "rename", label: t("APP", "TREE_RENAME"), run: () => setRenaming(true) }]
      : []),
    ...(can.reply
      ? [{ key: "reply", label: t("APP", "TREE_REPLY"), run: () => setReplying(true) }]
      : []),
  ];

  return (
    <div data-testid="tree-node" data-id={id} data-depth={depth}>
      <div className="relative">
        {drag && !dragging ? (
          <div
            ref={dropBefore.setNodeRef}
            data-testid="tree-drop-before"
            className="pointer-events-none absolute inset-x-0 -top-1 z-10 h-2"
            style={{ paddingLeft: 12 + depth * INDENT }}
          >
            {dropBefore.isOver ? <div className="mt-[3px] h-0.5 rounded-full bg-primary" /> : null}
          </div>
        ) : null}
        <div
          ref={(el) => {
            draggable.setNodeRef(el);
            dropInto.setNodeRef(el);
          }}
          {...draggable.attributes}
          {...draggable.listeners}
          role="treeitem"
          aria-level={depth + 1}
          aria-expanded={hasChildren ? open : undefined}
          aria-selected={false}
          tabIndex={0}
          data-tree-row
          data-id={id}
          data-testid="tree-row"
          data-open={open || undefined}
          data-orphan={orphan || undefined}
          data-drop-refused={drag && !dragging && !intoOk ? true : undefined}
          onKeyDown={onKeyDown}
          onDoubleClick={() => can.rename && setRenaming(true)}
          className={cn(
            "group flex min-h-8 cursor-default items-start gap-1.5 rounded-md py-1 pr-2 text-[13px] outline-none",
            "hover:bg-hover focus-visible:bg-selected focus-visible:ring-2 focus-visible:ring-ring/60",
            dragging && "opacity-40",
            dropInto.isOver && "bg-primary/10 ring-2 ring-primary/50",
            can.reparent && "cursor-grab",
          )}
          style={{ paddingLeft: 12 + depth * INDENT }}
        >
          {hasChildren ? (
            <button
              type="button"
              tabIndex={-1}
              data-testid="tree-toggle"
              aria-label={t("APP", open ? "TREE_COLLAPSE" : "TREE_EXPAND")}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => ctx.setOpen(id, !open)}
              className="mt-0.5 grid size-5 shrink-0 place-items-center rounded text-muted-foreground hover:bg-selected hover:text-foreground"
            >
              <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} />
            </button>
          ) : (
            <span className="size-5 shrink-0" />
          )}
          {typeof avatar === "string" && avatar ? (
            <span className="mt-px grid size-6 shrink-0 place-items-center rounded-full bg-primary/12 text-[10px] font-semibold text-primary">
              {avatar}
            </span>
          ) : Icon ? (
            <Icon className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
          ) : null}
          {orphan ? (
            <Tip label={t("APP", "TREE_ORPHAN")}>
              <CornerLeftUp
                data-testid="tree-orphan"
                className="mt-1 size-3.5 shrink-0 text-muted-foreground/60"
              />
            </Tip>
          ) : null}
          <div className="min-w-0 flex-1 pt-0.5 leading-snug" data-testid="tree-label">
            {renaming ? (
              <RenameInput
                initial={label}
                onDone={(value) => {
                  setRenaming(false);
                  if (value !== null && value !== label) void ctx.onRename(row, value);
                }}
              />
            ) : (
              <>
                <TreeNodeLabel row={row} />
                {typeof path === "string" && path ? (
                  <span className="ml-2 text-xs text-muted-foreground">{path}</span>
                ) : null}
              </>
            )}
          </div>
          {count > 0 ? (
            <span
              data-testid="tree-count"
              className="mt-0.5 shrink-0 rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums"
            >
              {count}
            </span>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                tabIndex={-1}
                data-testid="tree-menu"
                aria-label={t("APP", "TREE_MENU")}
                onPointerDown={(e) => e.stopPropagation()}
                className="grid size-6 shrink-0 place-items-center rounded text-muted-foreground opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 hover:bg-selected hover:text-foreground data-[state=open]:opacity-100"
              >
                <MoreVertical className="size-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {menu.map((m) => (
                <DropdownMenuItem key={m.key} data-testid={`tree-${m.key}`} onSelect={m.run}>
                  {m.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {replying ? (
        <ReplyBox
          depth={depth + 1}
          onCancel={() => setReplying(false)}
          onSend={async (text) => {
            await ctx.onReply(row, text);
            setReplying(false);
          }}
        />
      ) : null}
      {open ? (
        lazy ? (
          <LazyChildren parent={id} depth={depth} />
        ) : (
          <NodeList rows={built} depth={depth + 1} />
        )
      ) : null}
    </div>
  );
}

function RenameInput({ initial, onDone }: { initial: string; onDone: (v: string | null) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  useEffect(() => ref.current?.select(), []);
  return (
    <input
      ref={ref}
      data-testid="tree-rename-input"
      defaultValue={initial}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(e.currentTarget.value.trim() || null);
        if (e.key === "Escape") finish(null);
      }}
      onBlur={(e) => finish(e.currentTarget.value.trim() || null)}
      className="h-6 w-full rounded border border-border-strong bg-surface px-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring/60"
    />
  );
}

function ReplyBox({
  depth,
  onSend,
  onCancel,
}: {
  depth: number;
  onSend: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <div className="py-1 pr-3" style={{ paddingLeft: 12 + depth * INDENT + 26 }}>
      <textarea
        // biome-ignore lint/a11y/noAutofocus: opened on purpose from the menu
        autoFocus
        rows={2}
        disabled={busy}
        data-testid="tree-reply-input"
        placeholder={t("APP", "TREE_REPLY_PLACEHOLDER")}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
          if (e.key !== "Enter" || e.shiftKey) return;
          e.preventDefault();
          const text = e.currentTarget.value.trim();
          if (!text) return;
          setBusy(true);
          onSend(text).catch(() => setBusy(false));
        }}
        className="w-full resize-y rounded-md border border-border-strong bg-surface px-2 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-ring/60"
      />
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        {busy ? <Spinner className="size-3" /> : null}
        {t("APP", "TREE_REPLY_HINT")}
      </div>
    </div>
  );
}
