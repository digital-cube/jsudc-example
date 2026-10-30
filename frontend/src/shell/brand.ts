import { storage } from "@jsudc/react";
import { useCallback, useLayoutEffect, useSyncExternalStore } from "react";
import { useLocation, useNavigate } from "react-router";

/*
 * The brand switch: `acme` sets `data-brand="acme"` on <html>, which is all
 * src/brand.css keys on; `default` removes it. The attribute is the state,
 * localStorage keeps it across reloads, `?brand=` picks one from a link.
 */

export const BRANDS = ["default", "acme"] as const;
export type Brand = (typeof BRANDS)[number];

export const BRAND_KEY = "example:brand";
export const BRAND_PARAM = "brand";

export const isBrand = (v: unknown): v is Brand => BRANDS.includes(v as Brand);

/** The stored brand; `default` before the first choice. */
export function loadBrand(): Brand {
  const v = storage.get(BRAND_KEY);
  return isBrand(v) ? v : "default";
}

/** Puts `brand` on <html> (only the attribute, nothing stored). */
export function applyBrand(brand: Brand): void {
  const root = document.documentElement;
  if (brand === "default") root.removeAttribute("data-brand");
  else root.setAttribute("data-brand", brand);
}

const listeners = new Set<() => void>();

export function setBrand(brand: Brand): void {
  storage.set(BRAND_KEY, brand);
  applyBrand(brand);
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function snapshot(): Brand {
  const v = document.documentElement.getAttribute("data-brand");
  return isBrand(v) ? v : "default";
}

export function useBrand(): [Brand, (brand: Brand) => void] {
  const brand = useSyncExternalStore(subscribe, snapshot);
  return [brand, useCallback(setBrand, [])];
}

/**
 * `?brand=<name>` on any route selects that brand (stored, as if switched)
 * and leaves the address bar without it, so the switch owns the choice from
 * then on. A layout effect: it runs before the data view's own effects read
 * or write the query string.
 */
export function useBrandFromUrl(): void {
  const location = useLocation();
  const navigate = useNavigate();
  useLayoutEffect(() => {
    const params = new URLSearchParams(location.search);
    const wanted = params.get(BRAND_PARAM);
    if (wanted === null) return;
    if (isBrand(wanted)) setBrand(wanted);
    params.delete(BRAND_PARAM);
    const search = params.toString();
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : "", hash: location.hash },
      { replace: true },
    );
  }, [location, navigate]);
}
