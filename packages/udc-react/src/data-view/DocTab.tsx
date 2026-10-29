import { marked } from "marked";
import { useMemo } from "react";

/**
 * The collection's README, rendered from markdown. The text is the
 * collection directory's own `README.md` / `README.<locale>.md`, served by
 * our backend, so it is trusted as the code is.
 */
export function DocTab({ markdown }: { markdown: string }) {
  const html = useMemo(() => marked.parse(markdown, { async: false, gfm: true }), [markdown]);
  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto" data-testid="doc-tab">
      <article
        className="udc-prose mx-auto max-w-3xl px-8 py-7"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: our own README, see above
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
