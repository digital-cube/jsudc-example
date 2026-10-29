import type { Row } from "@jsudc/core";
import { CornerLeftUp, File, Folder } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { type FolderNav, isFolderRow } from "../renderers/types";

/**
 * The label of a row of a folder listing: a folder (and `..`) as a link that
 * opens it, a file as a link to its preview when there is one, else plain.
 */
export function FolderEntry({
  row,
  nav,
  children,
  className,
}: {
  row: Row;
  nav: FolderNav;
  children: ReactNode;
  className?: string;
}) {
  const dir = isFolderRow(row, nav);
  const up = dir && row[nav.options.label_field] === "..";
  const Icon = up ? CornerLeftUp : dir ? Folder : File;
  const path = String(row[nav.options.path_field] ?? "");
  const onClick = dir ? () => nav.open(path) : nav.openFile ? () => nav.openFile?.(row) : undefined;
  const icon = (
    <Icon
      aria-hidden
      className={cn("size-4 shrink-0", dir ? "text-sem-info" : "text-muted-foreground")}
    />
  );
  if (!onClick) {
    return (
      <span className={cn("flex min-w-0 items-center gap-2", className)}>
        {icon}
        {children}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-testid={dir ? "folder-link" : "file-link"}
      data-path={path}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        "flex min-w-0 items-center gap-2 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        dir
          ? "font-medium text-sem-info underline-offset-2 hover:underline"
          : "hover:text-foreground hover:underline underline-offset-2",
        className,
      )}
    >
      {icon}
      {children}
    </button>
  );
}
