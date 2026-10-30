import { useI18n } from "@jsudc/react";
import { ArrowRight } from "lucide-react";
import { marked } from "marked";
import { Link } from "react-router";
import { BRAND_PARAM, type Brand } from "./brand";

interface Layer {
  id: string;
  title: string;
  body: string;
  link: string;
  brand: Brand;
}

const LAYERS: Layer[] = [
  { id: "kit", title: "KIT_TITLE", body: "KIT_BODY", link: "KIT_LINK", brand: "default" },
  { id: "brand", title: "BRAND_TITLE", body: "BRAND_BODY", link: "BRAND_LINK", brand: "acme" },
];

/** `/udc/companies` with `brand` picked on arrival (shell/brand.ts, useBrandFromUrl). */
export const companiesWith = (brand: Brand): string => `/udc/companies?${BRAND_PARAM}=${brand}`;

/** `/examples`: the two layers of @jsudc/react the app proves, each with a link to see it. */
export function ExamplesPage() {
  const { t } = useI18n();
  return (
    <div className="udc-scroll-thin min-h-0 flex-1 overflow-y-auto" data-testid="examples-page">
      <div className="mx-auto max-w-3xl px-8 py-7">
        <h1 className="text-lg font-semibold tracking-tight">{t("EXAMPLES", "TITLE")}</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">{t("EXAMPLES", "LEAD")}</p>
        {LAYERS.map((layer) => (
          <section
            key={layer.id}
            data-testid={`examples-${layer.id}`}
            className="mt-6 rounded-lg border border-border bg-surface p-5"
          >
            <h2 className="text-[15px] font-semibold">{t("EXAMPLES", layer.title)}</h2>
            <p
              className="udc-prose mt-2 text-[13px] leading-relaxed"
              // biome-ignore lint/security/noDangerouslySetInnerHtml: the example's own dictionary
              dangerouslySetInnerHTML={{
                __html: marked.parseInline(t("EXAMPLES", layer.body), { async: false }),
              }}
            />
            <Link
              to={companiesWith(layer.brand)}
              data-testid={`examples-link-${layer.brand}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-primary hover:underline"
            >
              {t("EXAMPLES", layer.link)}
              <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </section>
        ))}
      </div>
    </div>
  );
}
