import { type FilterNode, isUdcError, type Row } from "@jsudc/core";
import {
  type BulkActionHandlers,
  cn,
  ErrorState,
  UdcDataView,
  udcKeys,
  useI18n,
  useTimezone,
  useUdcAction,
  useUdcAllRows,
  useUdcChanges,
  useUdcClient,
  useUdcMutate,
  useUrlSearchParams,
} from "@jsudc/react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Spinner,
  useToast,
} from "@jsudc/react/ui";
import { moveToFolder, simulateIncoming } from "@jsudc/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  FileText,
  Folder,
  FolderInput,
  Inbox,
  ListChecks,
  type LucideIcon,
  Mail as MailIcon,
  MailOpen,
  MailPlus,
  Newspaper,
  Send,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo } from "react";
import { type DemoUserChoice, useDemoUser } from "./demoUser";

/*
 * /mail: a three-pane screen written in the example. The folder list and the
 * reading pane are the host's own components; the message list between them
 * is `<UdcDataView collection="mail_messages">` embedded: the open folder as
 * the host's filter, no chrome, a control of the host's in the toolbar, its
 * URL state under `list.`, and row activation driving the reading pane.
 *
 * The page's own state is in the query string too: `?folder=<id>` (the open
 * folder), `?m=<id>` (the open message), `?unread=1` (the toolbar's switch).
 * A link to another user's message opens the pane on "not found": the
 * server's row scope answers exactly as for an id that does not exist.
 *
 * 0.5.0 (the view's yaml declares the first two):
 * - selection and the bulk bar, switched on by the toolbar's "Select"
 *   (`selectable`, `?select=1`): mark read / unread through `set`, delete
 *   built in, and "archive" through the handler below, which moves the
 *   selection (ids, or the filter minus the unticked rows for "select all
 *   that match") with the host action `mail.move_to_folder`;
 * - a menu of row actions, each where its `when` holds, archive by the same handler;
 * - the typed host actions of @jsudc/shared, called with `useUdcAction`:
 *   "move to folder" in the reading pane, "simulate incoming mail" in the toolbar;
 * - live updates: the change feed refetches the list; a change of the
 *   messages also refreshes the folder counts, the open message and its trail;
 * - the search box answered by the server's full-text index, by rank;
 * - the list windowed (`virtualize`): the Newsletters folder holds 5,000.
 *
 * 0.6.0: newest first is the view's `default_sort`, applied by the data view
 * without a `list.sort` in the URL and set aside while a search is typed (the
 * server then answers by rank); the page no longer writes a sort itself.
 */

const MESSAGES = "mail_messages";
const FOLDERS = "mail_folders";
const AUDIT = "mail_audit";

const ROLE_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  sent: Send,
  drafts: FileText,
  archive: Archive,
  trash: Trash2,
  newsletters: Newspaper,
};

/** Always windowed, even a short folder, with a deeper overscan for fast j / k. */
const VIRTUALIZE = { enabled: true, overscan: 20 } as const;

const readKey = (user: DemoUserChoice, id: string) =>
  ["example", "mail", "read", user, id] as const;

export function MailPage() {
  const { t } = useI18n();
  const [user] = useDemoUser();
  const [params, setParams] = useUrlSearchParams();
  const folders = useUdcAllRows({ collection: FOLDERS, sort: [{ field: "position", dir: "asc" }] });

  // The open folder: `?folder=`, if it is one of this user's, else the Inbox.
  const folderRows = folders.rows;
  const asked = params.get("folder");
  const folder =
    folderRows.find((f) => f.__meta.id === asked) ??
    folderRows.find((f) => f.role === "inbox") ??
    folderRows[0];
  const openId = params.get("m");
  const unreadOnly = params.get("unread") === "1";
  // Selection is the view's (multiselect, bulk_actions); the toolbar's "Select" switches it on
  // with `selectable`. Until then the list is 0.4.0's: the active row is the selected one.
  const selecting = params.get("select") === "1";

  const setParam = useCallback(
    (key: string, value: string | null) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (value === null) next.delete(key);
          else next.set(key, value);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  // The host's filter: the open folder (and, with the toolbar's switch, unread only).
  const folderId = folder?.__meta.id;
  const hostFilter = useMemo<FilterNode | undefined>(() => {
    if (!folderId) return undefined;
    const inFolder: FilterNode = { field: "folder_id", op: "eq", value: folderId };
    return unreadOnly ? { and: [inFolder, { field: "seen", op: "eq", value: false }] } : inFolder;
  }, [folderId, unreadOnly]);

  const markSeen = useMarkSeen();
  useLiveCounts();
  const archiveId = folderRows.find((f) => f.role === "archive")?.__meta.id;
  const actions = useArchiveHandler(archiveId);
  const open = useCallback(
    (row: Row | null) => setParam("m", row ? row.__meta.id : null),
    [setParam],
  );
  const activate = useCallback(
    (row: Row) => {
      open(row);
      if (row.seen === false) markSeen(row.__meta.id, true, row.__meta.version);
    },
    [open, markSeen],
  );

  if (folders.error) {
    return (
      <div className="flex flex-1 items-center justify-center" data-testid="mail-page">
        <ErrorState error={folders.error} onRetry={() => void folders.refetch()} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="mail-page" data-user={user}>
      <nav
        aria-label={t("MAIL", "FOLDERS")}
        data-testid="mail-folders"
        className="udc-scroll-thin flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface/60 p-3"
      >
        <h2 className="px-2 pb-1 text-[11px] font-semibold tracking-wide text-muted-foreground/80 uppercase">
          {t("MAIL", "FOLDERS")}
        </h2>
        {folders.isLoading ? <Spinner /> : null}
        {folderRows.map((f) => {
          const Icon = ROLE_ICONS[String(f.role)] ?? Folder;
          const active = f.__meta.id === folderId;
          const unread = Number(f.unread_count ?? 0);
          return (
            <button
              key={f.__meta.id}
              type="button"
              data-testid={`mail-folder-${String(f.role)}`}
              data-folder-id={f.__meta.id}
              data-active={active ? "true" : undefined}
              aria-current={active ? "true" : undefined}
              onClick={() =>
                setParams(
                  (prev) => {
                    const next = new URLSearchParams(prev);
                    next.set("folder", f.__meta.id);
                    next.delete("m");
                    // A new folder starts on its first page.
                    next.delete("list.p");
                    return next;
                  },
                  { replace: true },
                )
              }
              className={cn(
                "flex h-8 items-center gap-2.5 rounded-md px-2 text-left text-[13px] font-medium transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "bg-selected text-foreground"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-primary")} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{String(f.name)}</span>
              {unread > 0 ? (
                <span
                  data-testid="mail-folder-unread"
                  className="rounded-full bg-primary/12 px-1.5 text-[11px] font-semibold text-primary tabular-nums"
                >
                  {unread}
                </span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <section
        aria-label={t("MAIL", "MESSAGES")}
        data-testid="mail-list"
        className="flex min-h-0 min-w-0 flex-1 flex-col border-r border-border"
      >
        {hostFilter ? (
          <UdcDataView
            // A new user is a new mailbox: start the view afresh.
            key={user}
            collection={MESSAGES}
            filter={hostFilter}
            chrome="embedded"
            pagingMode="infinite"
            urlPrefix="list."
            virtualize={VIRTUALIZE}
            selectable={selecting}
            actions={actions}
            toolbarStart={
              <>
                <Button
                  variant={unreadOnly ? "primary" : "outline"}
                  size="sm"
                  data-testid="mail-unread-only"
                  aria-pressed={unreadOnly}
                  onClick={() => setParam("unread", unreadOnly ? null : "1")}
                >
                  <MailIcon aria-hidden />
                  {t("MAIL", "UNREAD_ONLY")}
                </Button>
                <Button
                  variant={selecting ? "primary" : "outline"}
                  size="sm"
                  data-testid="mail-select-mode"
                  aria-pressed={selecting}
                  onClick={() => setParam("select", selecting ? null : "1")}
                >
                  <ListChecks aria-hidden />
                  {t("MAIL", "SELECT")}
                </Button>
                <SimulateIncoming />
              </>
            }
            activeRowId={openId}
            onActiveRowChange={open}
            onRowActivate={activate}
          />
        ) : null}
      </section>

      <ReadingPane user={user} id={openId} folders={folderRows} onToggleSeen={markSeen} />
    </div>
  );
}

/**
 * Set `seen` on a message: the library's mutation (optimistic in the list,
 * `expected_version` checked by the server), then the folder counts, the
 * open message and its audit trail read again — the `onMutate` hook wrote a
 * row there in the same transaction.
 */
function useMarkSeen() {
  const mutate = useUdcMutate(MESSAGES);
  const qc = useQueryClient();
  return useCallback(
    (id: string, seen: boolean, version?: number) => {
      mutate.mutate(
        {
          op: "update",
          id,
          row: { seen },
          ...(version === undefined ? {} : { expected_version: version }),
        },
        {
          onSettled: () => {
            void qc.invalidateQueries({ queryKey: udcKeys.lists(FOLDERS) });
            void qc.invalidateQueries({ queryKey: udcKeys.lists(AUDIT) });
            void qc.invalidateQueries({ queryKey: ["example", "mail", "read"] });
          },
        },
      );
    },
    [mutate, qc],
  );
}

/**
 * What the change feed does not know: the folders' counts are computed from
 * the messages, and the reading pane reads one message under a key of its
 * own. Whenever the feed says the messages changed — a bulk action here, a
 * move in another tab, a message that just arrived — those are read again.
 * (The list itself is refetched by the data view, which subscribes on its own.)
 */
function useLiveCounts() {
  const qc = useQueryClient();
  useUdcChanges(MESSAGES, () => {
    void qc.invalidateQueries({ queryKey: udcKeys.lists(FOLDERS) });
    void qc.invalidateQueries({ queryKey: udcKeys.lists(AUDIT) });
    void qc.invalidateQueries({ queryKey: ["example", "mail", "read"] });
  });
}

/**
 * The bulk bar's and the row menu's "archive": the view declares the kind
 * without `set`, so it comes here. One host action moves the rows — by
 * `ids` (a selection, or the one row of a menu), or by `filter` minus
 * `exceptIds` when "select all that match" is on (the folder has no total,
 * so the server counts what it moved).
 */
function useArchiveHandler(archiveId: string | undefined): BulkActionHandlers {
  const { t } = useI18n();
  const { toast } = useToast();
  const move = useUdcAction(moveToFolder, { invalidates: [MESSAGES, FOLDERS] });
  return useMemo<BulkActionHandlers>(
    () => ({
      archive: async ({ ids, filter, exceptIds, row, clearSelection }) => {
        if (!archiveId) return;
        const res = await move.mutateAsync(
          ids
            ? { folder_id: archiveId, ids }
            : {
                folder_id: archiveId,
                filter,
                ...(exceptIds?.length ? { except_ids: exceptIds } : {}),
              },
        );
        if (!row) clearSelection();
        toast({ title: t("MAIL", "ARCHIVED", { count: res.moved }) });
      },
    }),
    [archiveId, move.mutateAsync, toast, t],
  );
}

/**
 * The toolbar's "Simulate incoming mail": the backend writes a message into
 * this user's Inbox outside jsudc and announces it on the change feed. The
 * list and the Inbox count update by themselves, from the event; another
 * user's open mailbox hears nothing. No `invalidates` here on purpose.
 */
function SimulateIncoming() {
  const { t } = useI18n();
  const { toast } = useToast();
  const simulate = useUdcAction(simulateIncoming, {
    onSuccess: (res) => toast({ title: t("MAIL", "DELIVERED"), description: res.subject }),
  });
  return (
    <Button
      variant="outline"
      size="sm"
      data-testid="mail-simulate-incoming"
      disabled={simulate.isPending}
      onClick={() => simulate.mutate({})}
    >
      <MailPlus aria-hidden />
      {t("MAIL", "SIMULATE_INCOMING")}
    </Button>
  );
}

/**
 * "Move to…" in the reading pane: the typed host action from @jsudc/shared.
 * The payload is checked against its request schema by the compiler, the
 * answer against its response schema at run time.
 */
function MoveToFolder({ id, current, folders }: { id: string; current: string; folders: Row[] }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const qc = useQueryClient();
  const move = useUdcAction(moveToFolder, {
    invalidates: [MESSAGES, FOLDERS],
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["example", "mail", "read"] }),
    onError: (err) =>
      toast({ title: t("MAIL", "MOVE_FAILED"), description: err.message, variant: "danger" }),
  });
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" data-testid="mail-move" disabled={move.isPending}>
          <FolderInput aria-hidden />
          {t("MAIL", "MOVE_TO")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="mail-move-menu">
        <DropdownMenuLabel>{t("MAIL", "MOVE_TO")}</DropdownMenuLabel>
        {folders
          .filter((f) => String(f.name) !== current)
          .map((f) => (
            <DropdownMenuItem
              key={f.__meta.id}
              data-testid={`mail-move-to-${String(f.role)}`}
              onSelect={() => move.mutate({ folder_id: f.__meta.id, ids: [id] })}
            >
              {String(f.name)}
            </DropdownMenuItem>
          ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ReadingPane({
  user,
  id,
  folders,
  onToggleSeen,
}: {
  user: DemoUserChoice;
  id: string | null;
  folders: Row[];
  onToggleSeen: (id: string, seen: boolean, version?: number) => void;
}) {
  const { t } = useI18n();
  const client = useUdcClient();
  const { timeZone } = useTimezone();
  const message = useQuery({
    queryKey: readKey(user, id ?? ""),
    queryFn: ({ signal }) =>
      client.call("read", { collection: MESSAGES, id: id ?? "" }, { signal }),
    enabled: id !== null,
  });
  const notFound = isUdcError(message.error) && message.error.code === "not_found";
  const row = message.data?.row;

  return (
    <aside
      aria-label={t("MAIL", "READING_PANE")}
      aria-live="polite"
      data-testid="mail-reading-pane"
      data-message-id={row?.__meta.id}
      className="udc-scroll-thin flex w-[38%] min-w-80 shrink-0 flex-col overflow-y-auto bg-surface"
    >
      {id === null ? (
        <Placeholder icon={MailOpen} text={t("MAIL", "NONE_OPEN")} testId="mail-none-open" />
      ) : message.isLoading ? (
        <div className="flex flex-1 items-center justify-center">
          <Spinner />
        </div>
      ) : notFound ? (
        <Placeholder icon={MailIcon} text={t("MAIL", "NOT_FOUND")} testId="mail-not-found" />
      ) : message.error ? (
        <div className="flex flex-1 items-center justify-center">
          <ErrorState error={message.error} onRetry={() => void message.refetch()} />
        </div>
      ) : row ? (
        <article className="flex flex-col gap-4 p-6">
          <header className="flex flex-col gap-1.5">
            <h1 className="text-lg font-semibold tracking-tight" data-testid="mail-subject">
              {String(row.subject)}
            </h1>
            <div className="text-[13px]">
              <span className="font-medium" data-testid="mail-sender">
                {String(row.sender_name)}
              </span>{" "}
              <span className="text-muted-foreground">&lt;{String(row.sender_email)}&gt;</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <time dateTime={String(row.received_at)}>
                {formatInstant(String(row.received_at), timeZone)}
              </time>
              <span aria-hidden>·</span>
              <span data-testid="mail-folder-name">{String(row.folder_name)}</span>
            </div>
          </header>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="mail-toggle-seen"
              data-seen={row.seen ? "true" : "false"}
              onClick={() => onToggleSeen(row.__meta.id, row.seen !== true, row.__meta.version)}
            >
              {row.seen ? <MailIcon aria-hidden /> : <MailOpen aria-hidden />}
              {t("MAIL", row.seen ? "MARK_UNREAD" : "MARK_READ")}
            </Button>
            <MoveToFolder id={row.__meta.id} current={String(row.folder_name)} folders={folders} />
          </div>
          <div className="text-[14px] leading-relaxed whitespace-pre-line" data-testid="mail-body">
            {String(row.body ?? "")}
          </div>
          <AuditTrail id={row.__meta.id} />
        </article>
      ) : null}
    </aside>
  );
}

/** What the messages' `onMutate` wrote for this message, newest first. */
function AuditTrail({ id }: { id: string }) {
  const { t } = useI18n();
  const { timeZone } = useTimezone();
  const trail = useUdcAllRows({
    collection: AUDIT,
    filter: { field: "message_id", op: "eq", value: id },
    sort: [{ field: "at", dir: "desc" }],
    max: 20,
  });
  return (
    <section
      data-testid="mail-audit"
      className="mt-2 rounded-md border border-border p-3 text-xs text-muted-foreground"
    >
      <h2 className="mb-1.5 font-semibold text-foreground">{t("MAIL", "AUDIT_TITLE")}</h2>
      {trail.rows.length === 0 ? (
        <p>{t("MAIL", "AUDIT_EMPTY")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {trail.rows.map((r) => (
            <li key={r.__meta.id} data-testid="mail-audit-row" data-op={String(r.op)}>
              <time className="tabular-nums">{formatInstant(String(r.at), timeZone)}</time>{" "}
              <span className="font-medium text-foreground">{String(r.op)}</span>{" "}
              <code>{JSON.stringify(r.changes)}</code>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Placeholder({
  icon: Icon,
  text,
  testId,
}: {
  icon: LucideIcon;
  text: string;
  testId: string;
}) {
  return (
    <div
      data-testid={testId}
      className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-sm text-muted-foreground"
    >
      <Icon className="size-8 opacity-40" aria-hidden />
      {text}
    </div>
  );
}

function formatInstant(iso: string, timeZone: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(d);
}
