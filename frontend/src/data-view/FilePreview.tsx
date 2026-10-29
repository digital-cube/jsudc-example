import type { Row } from "@jsudc/core";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogBody, DialogContent } from "../components/ui/dialog";
import { Skeleton } from "../components/ui/misc";
import { useI18n } from "../i18n/i18n";
import { useUdcClient } from "../udc/provider";

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

/** The URL of one file of a filesystem collection (`GET /udc/files/blob`). */
export function blobUrl(httpUrl: string, collection: string, path: string): string {
  const q = new URLSearchParams({ collection, path });
  return `${httpUrl}/udc/files/blob?${q}`;
}

/** A file of a filesystem collection: an image as an image, text as text, else why not. */
export function FilePreview({
  collection,
  row,
  pathField,
  onClose,
}: {
  collection: string;
  row: Row | null;
  pathField: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const client = useUdcClient();
  const path = row ? String(row[pathField] ?? "") : "";
  const url = blobUrl(client.httpUrl, collection, path);
  const image = IMAGE.test(path);
  const text = useQuery({
    queryKey: ["udc", "blob", collection, path],
    queryFn: async ({ signal }) => {
      const res = await fetch(url, { signal });
      if (!res.ok) {
        const reason = res.status === 413 ? "PREVIEW_TOO_LARGE" : "PREVIEW_UNAVAILABLE";
        throw new Error(reason);
      }
      return res.text();
    },
    enabled: row !== null && !image,
    retry: false,
    staleTime: 30_000,
  });
  return (
    <Dialog open={row !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent title={path} className="max-w-3xl" data-testid="file-preview">
        <DialogBody>
          {image ? (
            <div className="grid place-items-center rounded-lg bg-[repeating-conic-gradient(var(--color-muted)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-4">
              <img
                src={url}
                alt={path}
                data-testid="preview-image"
                className="max-h-[60vh] max-w-full"
              />
            </div>
          ) : text.isLoading ? (
            <Skeleton className="h-40" />
          ) : text.error ? (
            <p className="text-sm text-muted-foreground" data-testid="preview-error">
              {t(
                "APP",
                text.error.message === "PREVIEW_TOO_LARGE"
                  ? "PREVIEW_TOO_LARGE"
                  : "PREVIEW_UNAVAILABLE",
              )}
            </p>
          ) : (
            <pre
              data-testid="preview-text"
              className="scroll-thin max-h-[60vh] overflow-auto rounded-lg bg-muted/60 p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap"
            >
              {text.data}
            </pre>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
