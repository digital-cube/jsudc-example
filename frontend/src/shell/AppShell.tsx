import { Building2, CalendarDays, Database, Kanban, Languages, Moon, Sun } from "lucide-react";
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

const COLLECTION_ICONS: Record<string, typeof Database> = {
  companies: Building2,
  appointments: CalendarDays,
  tickets: Kanban,
};

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
      className="hidden w-48 shrink-0 flex-col border-r border-border bg-surface/60 p-3 md:flex lg:w-56"
    >
      <div className="px-2 pt-1 pb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
        {t("APP", "COLLECTIONS")}
      </div>
      {collections.isLoading ? (
        <div className="flex flex-col gap-2 px-2">
          <Skeleton className="h-6" />
          <Skeleton className="h-6 w-3/4" />
        </div>
      ) : null}
      {collections.data?.collections.length === 0 ? (
        <div className="px-2 text-xs text-muted-foreground">{t("APP", "NO_COLLECTIONS")}</div>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {collections.data?.collections.map((c) => {
          const Icon = COLLECTION_ICONS[c.name] ?? Database;
          return (
            <li key={c.name}>
              <NavLink
                to={`/udc/${c.name}`}
                data-testid={`nav-${c.name}`}
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
                    {t("COLLECTIONS", c.name)}
                  </>
                )}
              </NavLink>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
