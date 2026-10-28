import {
  type CollectionListing,
  SOURCE_GROUPS,
  type SourceGroup,
  sourceGroup,
} from "@jsudc/udc-core";
import {
  Activity,
  Building2,
  CalendarDays,
  ChartLine,
  Database,
  FolderGit2,
  FolderOpen,
  Globe,
  Kanban,
  Languages,
  type LucideIcon,
  Moon,
  Sun,
} from "lucide-react";
import { NavLink, Outlet } from "react-router";
import { Button } from "../components/ui/button";
import { Skeleton } from "../components/ui/misc";
import { Segmented } from "../components/ui/segmented";
import { Tip } from "../components/ui/tooltip";
import { useI18n } from "../i18n/i18n";
import { LOCALES, type Locale } from "../i18n/translations";
import { useTheme } from "../lib/theme";
import { cn } from "../lib/utils";
import { useUdcCollections } from "../udc/hooks";
import { TimezonePicker } from "./TimezonePicker";

const COLLECTION_ICONS: Record<string, LucideIcon> = {
  companies: Building2,
  appointments: CalendarDays,
  tickets: Kanban,
  quakes: Activity,
  repos: FolderGit2,
  metrics: ChartLine,
};

/** Where the rows live, as the sidebar heads its groups. */
export const GROUP_ICONS: Record<SourceGroup, LucideIcon> = {
  database: Database,
  files: FolderOpen,
  internet: Globe,
};

const GROUP_LABEL: Record<SourceGroup, string> = {
  database: "GROUP_DATABASE",
  files: "GROUP_FILES",
  internet: "GROUP_INTERNET",
};

export interface SidebarGroup {
  group: SourceGroup;
  collections: CollectionListing[];
}

/**
 * The collections by group (database, files, internet, in that order),
 * each in server order; a group without collections is left out. A listing
 * without `group` is placed by its `source_kind`, without either it is a
 * database one.
 */
export function groupCollections(collections: readonly CollectionListing[]): SidebarGroup[] {
  const groupOf = (c: CollectionListing): SourceGroup =>
    c.group ?? sourceGroup(c.source_kind ?? "postgres_jsonb");
  return SOURCE_GROUPS.map((group) => ({
    group,
    collections: collections.filter((c) => groupOf(c) === group),
  })).filter((g) => g.collections.length > 0);
}

export function AppShell() {
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar() {
  const { t, locale, setLocale } = useI18n();
  const { theme, toggle } = useTheme();
  const themeLabel = t("APP", theme === "dark" ? "THEME_LIGHT" : "THEME_DARK");
  return (
    <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-2.5">
        <div className="grid size-7 place-items-center rounded-lg bg-primary text-primary-foreground shadow-sm">
          <Database className="size-4" />
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight" data-testid="app-name">
            {t("APP", "NAME")}
          </div>
          <div className="text-[11px] text-muted-foreground">{t("APP", "TAGLINE")}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <TimezonePicker />
        <Languages className="size-4 text-muted-foreground" aria-hidden />
        <Segmented<Locale>
          aria-label={t("APP", "LANGUAGE")}
          data-testid="locale-switch"
          value={locale}
          onChange={setLocale}
          options={LOCALES.map((l) => ({
            value: l,
            label: l.toUpperCase(),
            testId: `locale-${l}`,
          }))}
        />
        <Tip label={themeLabel}>
          <Button
            variant="ghost"
            size="icon"
            aria-label={themeLabel}
            data-testid="theme-toggle"
            data-theme={theme}
            onClick={toggle}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </Tip>
      </div>
    </header>
  );
}

function Sidebar() {
  const { t } = useI18n();
  const collections = useUdcCollections();
  return (
    <nav
      aria-label={t("APP", "COLLECTIONS")}
      data-testid="sidebar"
      className="scroll-thin hidden w-48 shrink-0 flex-col overflow-y-auto border-r border-border bg-surface/60 p-3 pt-4 md:flex lg:w-56"
    >
      {collections.isLoading ? (
        <div className="flex flex-col gap-2 px-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : null}
      {collections.data?.collections.length === 0 ? (
        <div className="px-2 text-xs text-muted-foreground">{t("APP", "NO_COLLECTIONS")}</div>
      ) : null}
      <div className="flex flex-col gap-3">
        {groupCollections(collections.data?.collections ?? []).map(
          ({ group, collections: list }) => {
            const GroupIcon = GROUP_ICONS[group];
            return (
              <section
                key={group}
                data-testid={`nav-group-${group}`}
                aria-labelledby={`nav-group-${group}-label`}
              >
                <h2
                  id={`nav-group-${group}-label`}
                  className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/80 uppercase"
                >
                  <GroupIcon className="size-3.5" aria-hidden />
                  {t("APP", GROUP_LABEL[group])}
                </h2>
                <ul className="flex flex-col gap-0.5">
                  {list.map((c) => (
                    <SidebarItem
                      key={c.name}
                      name={c.name}
                      icon={COLLECTION_ICONS[c.name] ?? GroupIcon}
                    />
                  ))}
                </ul>
              </section>
            );
          },
        )}
      </div>
    </nav>
  );
}

function SidebarItem({ name, icon: Icon }: { name: string; icon: LucideIcon }) {
  const { t } = useI18n();
  return (
    <li>
      <NavLink
        to={`/udc/${name}`}
        data-testid={`nav-${name}`}
        className={({ isActive }) =>
          cn(
            "flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] font-medium transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            isActive
              ? "bg-selected text-foreground"
              : "text-muted-foreground hover:bg-hover hover:text-foreground",
          )
        }
      >
        {({ isActive }) => (
          <>
            <Icon className={cn("size-4", isActive && "text-primary")} />
            {t("COLLECTIONS", name)}
          </>
        )}
      </NavLink>
    </li>
  );
}
