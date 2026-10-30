import { useI18n } from "@jsudc/react";
import { marked } from "marked";
import { useMemo } from "react";
import readme from "../../../README.md?raw";

/**
 * The README's first section: everything above its first `##` heading.
 * A relative link points into the repository, not at a route of this app,
 * so it is kept as text instead; an image under `frontend/public/` is one
 * this app serves, so it points there.
 */
export function readmeIntro(markdown: string): string {
  const cut = markdown.search(/^## /m);
  const intro = cut === -1 ? markdown : markdown.slice(0, cut);
  return intro
    .replace(/!\[([^\]]*)\]\(frontend\/public\//g, "![$1](/")
    .replace(/(?<!!)\[([^\]]+)\]\((?!https?:|\/)[^)]*\)/g, "$1")
    .trim();
}

/** `/about`: what this application is, from the README (in Serbian from the translations). */
export function AboutPage() {
  const { t, tMaybe, locale } = useI18n();
  const markdown =
    locale === "en" ? readmeIntro(readme) : (tMaybe("ABOUT", "README") ?? readmeIntro(readme));
  const html = useMemo(() => marked.parse(markdown, { async: false, gfm: true }), [markdown]);
  return (
    <div className="udc-scroll-thin min-h-0 flex-1 overflow-y-auto" data-testid="about-page">
      <div className="mx-auto max-w-3xl px-8 pt-7">
        <h1 className="sr-only">{t("ABOUT", "TITLE")}</h1>
        <p className="text-[13px] text-muted-foreground">{t("ABOUT", "LEAD")}</p>
      </div>
      <article
        className="udc-prose mx-auto max-w-3xl px-8 py-5"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: the repository's own README
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
