import type { DescribeResponse } from "@jsudc/core";
import { Skeleton } from "../components/ui/misc";
import { Select } from "../components/ui/select";
import { useI18n } from "../i18n/i18n";
import { useKanbanBoard } from "./useKanbanBoard";

/** The board select in the toolbar; writes `?board=`. */
export function KanbanBoardSwitcher({
  describe,
}: {
  collection: string;
  describe: DescribeResponse;
}) {
  const { t } = useI18n();
  const { boards, boardId, setBoard, isLoading } = useKanbanBoard(describe);
  if (isLoading) return <Skeleton className="h-8 w-44" />;
  if (boards.length === 0) return null;
  return (
    <Select
      aria-label={t("APP", "KANBAN_BOARD")}
      data-testid="board-switcher"
      className="w-48"
      value={boardId ?? undefined}
      onValueChange={setBoard}
      options={boards.map((b) => ({ value: b.id, label: b.label }))}
    />
  );
}
