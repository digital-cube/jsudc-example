import { ChevronRight, FolderOpen } from "lucide-react";
import { useI18n } from "../i18n/i18n";
import { folderCrumbs } from "./folder";

/** Where the folder listing is: the root, then each folder down to the open one; each opens on click. */
export function FolderBar({
  folder,
  onOpen,
}: {
  folder: string | null;
  onOpen: (path: string) => void;
}) {
  const { t } = useI18n();
  const crumbs = folderCrumbs(folder);
  const btn =
    "rounded px-1.5 py-0.5 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <nav
      aria-label={t("APP", "FOLDER_PATH")}
      data-testid="folder-bar"
      data-folder={folder ?? ""}
      className="flex flex-wrap items-center gap-0.5 border-b border-border bg-muted/30 px-3 py-1.5 text-[13px] text-muted-foreground"
    >
      <FolderOpen className="mr-1 size-4 text-sem-info" aria-hidden />
      <button
        type="button"
        data-testid="crumb-root"
        className={crumbs.length === 0 ? `${btn} font-medium text-foreground` : btn}
        onClick={() => onOpen("")}
      >
        {t("APP", "FOLDER_ROOT")}
      </button>
      {crumbs.map((c, i) => (
        <span key={c.path} className="flex items-center gap-0.5">
          <ChevronRight className="size-3.5 opacity-60" aria-hidden />
          <button
            type="button"
            data-testid={`crumb-${c.path}`}
            className={i === crumbs.length - 1 ? `${btn} font-medium text-foreground` : btn}
            onClick={() => onOpen(c.path)}
          >
            {c.name}
          </button>
        </span>
      ))}
    </nav>
  );
}
