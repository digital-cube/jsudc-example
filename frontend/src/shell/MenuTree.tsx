import type { CollectionListing } from "@jsudc/core";
import { cn, resolveIcon, Skeleton, useI18n, useUdcAllRows } from "@jsudc/react";
import { ChevronRight } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import {
  activeLeaf,
  buildMenu,
  loadMenuExpanded,
  type MenuItem,
  menuLabel,
  saveMenuExpanded,
  withOpen,
} from "./menu";

/** The collection the sidebar is drawn from; another deployment may name its own. */
export const MENU_COLLECTION = import.meta.env.VITE_MENU_COLLECTION?.trim() || "menu";

const INDENT = 14;

/** A collection's own leaf keeps the old sidebar's test id: `nav-<collection>`. */
function testIdOf(item: MenuItem): string {
  const m = item.isDynamic && item.url ? /^\/udc\/([a-z0-9_]+)$/.exec(item.url) : null;
  return m ? `nav-${m[1]}` : `menu-${item.code}`;
}

/** Move the focus to the previous / next row on screen, or to the row with `id`. */
function focusRow(from: HTMLElement, where: -1 | 1 | string) {
  const tree = from.closest('[role="tree"]');
  if (!tree) return;
  const rows = [...tree.querySelectorAll<HTMLElement>("[data-menu-row]")];
  const target =
    typeof where === "string"
      ? rows.find((r) => r.dataset.id === where)
      : rows[rows.indexOf(from) + where];
  target?.focus();
}

/**
 * The sidebar, drawn from the menu collection (`yaml_menu`): every row in
 * one list (the server has already resolved the `udc:collections` branches),
 * built into a tree here. A node with children is a toggle, a leaf a link to
 * its `url`; the leaf the location activates is highlighted and, when it
 * changes, the way to it is opened. What is open is kept under
 * `udc:menu:expanded`.
 */
export function MenuTree({ listing }: { listing: CollectionListing }) {
  const { t, tMaybe } = useI18n();
  const location = useLocation();
  const data = useUdcAllRows({ collection: listing.name, capabilities: listing.capabilities });
  const items = useMemo(
    () => buildMenu(data.rows, (key, code) => menuLabel(key, code, tMaybe)),
    [data.rows, tMaybe],
  );
  const active = useMemo(() => activeLeaf(items, location), [items, location]);

  const [open, setOpen] = useState<readonly string[]>(() => loadMenuExpanded() ?? []);
  const update = useCallback((next: (o: readonly string[]) => readonly string[]) => {
    setOpen((o) => {
      const n = next(o);
      if (n !== o) saveMenuExpanded(n);
      return n;
    });
  }, []);
  const toggle = useCallback(
    (id: string, expand: boolean) =>
      update((o) => (expand ? withOpen(o, [id]) : o.filter((i) => i !== id))),
    [update],
  );
  // The way to the active leaf is open on load and after every navigation.
  const activeId = active?.id;
  const activeAncestors = active?.ancestors;
  useEffect(() => {
    if (activeId && activeAncestors) update((o) => withOpen(o, activeAncestors));
  }, [activeId, activeAncestors, update]);

  const openSet = useMemo(() => new Set(open), [open]);

  if (data.isLoading) {
    return (
      <div className="flex flex-col gap-1.5 px-2" data-testid="menu-loading">
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-4/5" />
        <Skeleton className="h-5 w-3/5" />
        <Skeleton className="h-5 w-4/5" />
      </div>
    );
  }
  return (
    <div
      role="tree"
      aria-label={t("APP", "NAV_MENU")}
      data-testid="menu-tree"
      className="flex flex-col gap-0.5"
    >
      {items.map((item) => (
        <MenuNode
          key={item.id}
          item={item}
          level={0}
          open={openSet}
          activeId={activeId}
          onToggle={toggle}
        />
      ))}
    </div>
  );
}

function MenuNode({
  item,
  level,
  open,
  activeId,
  onToggle,
}: {
  item: MenuItem;
  level: number;
  open: ReadonlySet<string>;
  activeId: string | undefined;
  onToggle: (id: string, expand: boolean) => void;
}) {
  const hasChildren = item.children.length > 0;
  const expanded = hasChildren && open.has(item.id);
  const isActive = item.id === activeId;
  const Icon = resolveIcon(item.icon);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const el = e.currentTarget;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      focusRow(el, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowRight") {
      if (!hasChildren) return;
      e.preventDefault();
      if (!expanded) onToggle(item.id, true);
      else focusRow(el, 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      const parent = item.ancestors.at(-1);
      if (expanded) onToggle(item.id, false);
      else if (parent) focusRow(el, parent);
    }
  };

  const rowClass = cn(
    "flex h-8 w-full items-center gap-2 rounded-md pr-2 text-left text-[13px] font-medium transition-colors",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    isActive
      ? "bg-selected text-foreground"
      : "text-muted-foreground hover:bg-hover hover:text-foreground",
  );
  const body = (
    <>
      {hasChildren ? (
        <ChevronRight
          aria-hidden
          data-testid="menu-chevron"
          className={cn("size-3.5 shrink-0 transition-transform", expanded && "rotate-90")}
        />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
      )}
      {Icon ? (
        <Icon
          aria-hidden
          data-testid="menu-icon"
          data-icon={item.icon}
          className={cn("size-4 shrink-0", isActive && "text-primary")}
        />
      ) : null}
      <span className="truncate">{item.label}</span>
    </>
  );
  const common = {
    role: "treeitem",
    "aria-level": level + 1,
    "aria-expanded": hasChildren ? expanded : undefined,
    "aria-selected": isActive,
    "data-menu-row": true,
    "data-id": item.id,
    "data-code": item.code,
    "data-active": isActive || undefined,
    "data-testid": testIdOf(item),
    onKeyDown,
    className: rowClass,
    style: { paddingLeft: 6 + level * INDENT },
    title: item.label,
  } as const;

  return (
    <div>
      {item.url && !hasChildren ? (
        <Link to={item.url} aria-current={isActive ? "page" : undefined} {...common}>
          {body}
        </Link>
      ) : (
        <button type="button" {...common} onClick={() => onToggle(item.id, !expanded)}>
          {body}
        </button>
      )}
      {expanded ? (
        // biome-ignore lint/a11y/useSemanticElements: an ARIA tree group has no native element
        <div role="group" className="mt-0.5 flex flex-col gap-0.5">
          {item.children.map((child) => (
            <MenuNode
              key={child.id}
              item={child}
              level={level + 1}
              open={open}
              activeId={activeId}
              onToggle={onToggle}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
