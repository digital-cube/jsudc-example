import type { DescribeResponse, KanbanOptions } from "@jsudc/core";
import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router";
import { useUdcCollection, useUdcDescribe } from "../udc/hooks";
import { boardSource } from "./model";

export const BOARD_PARAM = "board";
const MAX_BOARDS = 200;

export interface BoardChoice {
  id: string;
  label: string;
}

export interface KanbanBoardState {
  opts: KanbanOptions | undefined;
  boards: BoardChoice[];
  /** `?board=` when it names a board, else the first board; `null` while loading. */
  boardId: string | null;
  setBoard: (id: string) => void;
  isLoading: boolean;
}

/**
 * The board on screen and the boards to switch between. The board collection
 * is the `ref` of the card's board field; it is listed in its `order` field
 * when it has the bucket order's name, else by label. The toolbar switcher
 * and the renderer both call this; they share the query.
 */
export function useKanbanBoard(describe: DescribeResponse): KanbanBoardState {
  const opts = describe.view.kanban_options;
  const source = opts ? boardSource(describe.schema, opts) : null;
  const boardsDescribe = useUdcDescribe(source?.collection ?? "");
  const boardFields = boardsDescribe.data?.schema.fields;
  const sortField =
    opts && boardFields?.[opts.bucket_order_field] ? opts.bucket_order_field : source?.labelField;

  const list = useUdcCollection({
    collection: source?.collection ?? "",
    sort: sortField ? [{ field: sortField }] : [],
    mode: "pages",
    pageLimit: MAX_BOARDS,
    enabled: source !== null && boardsDescribe.isSuccess,
  });

  const boards = useMemo(
    () =>
      list.rows.map((r) => ({
        id: r.__meta.id,
        label: String(r[source?.labelField ?? "name"] ?? r.__meta.id),
      })),
    [list.rows, source?.labelField],
  );

  const [params, setParams] = useSearchParams();
  const wanted = params.get(BOARD_PARAM);
  // Without a board collection the URL alone names the board.
  const boardId = source
    ? (boards.find((b) => b.id === wanted)?.id ?? boards[0]?.id ?? null)
    : wanted;

  const setBoard = useCallback(
    (id: string) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set(BOARD_PARAM, id);
          return next;
        },
        { replace: true },
      ),
    [setParams],
  );

  return {
    opts,
    boards,
    boardId,
    setBoard,
    isLoading: source !== null && (boardsDescribe.isLoading || list.isLoading),
  };
}
