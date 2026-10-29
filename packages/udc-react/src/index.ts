// @jsudc/react: the public surface. Everything a host needs to render one
// collection is here; the stylesheet is `@jsudc/react/styles.css` (or
// `@jsudc/react/tokens.css` for a host that runs Tailwind itself).

// UI primitives (Radix + Tailwind), with the toast and tooltip providers the data view needs.
export { Button, type ButtonProps } from "./components/ui/button";
export { Checkbox } from "./components/ui/checkbox";
export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogTrigger,
} from "./components/ui/dialog";
export {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./components/ui/dropdown-menu";
export { Input, inputClass, NativeSelect } from "./components/ui/input";
export { Kbd, Skeleton, Spinner } from "./components/ui/misc";
export {
  Popover,
  PopoverAnchor,
  PopoverClose,
  PopoverContent,
  PopoverTrigger,
} from "./components/ui/popover";
export { Segmented, type SegmentedOption } from "./components/ui/segmented";
export { Select, type SelectOption } from "./components/ui/select";
export { Toaster, type ToastInput, type ToastVariant, useToast } from "./components/ui/toast";
export { Tip, TooltipProvider } from "./components/ui/tooltip";
// One collection: the tabs its view declares, each drawn by a renderer from RENDERERS.
export { UdcDataView } from "./data-view/UdcDataView";
// Strings: the provider, the library dictionary and the helpers over it.
export {
  INTL_LOCALE,
  intlLocaleOf,
  isLocale,
  LOCALE_STORAGE_KEY,
  lookup,
  type Messages,
  makeT,
  mergeMessages,
  messageLocales,
  type Overlay,
  schemaLabelTerms,
  tableSection,
  UdcI18nProvider,
  type UdcI18nProviderProps,
  useI18n,
  type Vars,
} from "./i18n/i18n";
export {
  type BuiltinLocale,
  LOCALES,
  type Locale,
  type Term,
  TRANSLATIONS,
  type Translations,
} from "./i18n/translations";
// Icons, theme, helpers, renderer registry and types, the time zone.
export { LUCIDE_ICONS } from "./icons/lucide.generated";
export { FALLBACK_ICON, resolveIcon } from "./icons/resolve";
export { THEME_STORAGE_KEY, type Theme, ThemeProvider, useTheme } from "./lib/theme";
export { cn, humanize, storage } from "./lib/utils";
export {
  RENDERERS,
  type RendererTab,
  rendererEntry,
  rendererTabs,
  resolveTab,
} from "./renderers/registry";
export {
  type FolderNav,
  isFolderRow,
  type RendererCount,
  type RendererEntry,
  type RendererProps,
} from "./renderers/types";
export { EmptyState, ErrorState } from "./table/states";
export {
  BROWSER_TZ,
  COMMON_ZONES,
  TimezoneProvider,
  type TimezoneState,
  TZ_STORAGE_KEY,
  useTimezone,
} from "./time/timezone";
export {
  allZones,
  browserZone,
  isValidZone,
  offsetLabel,
  offsetMinutes,
  zoneCity,
} from "./time/zoned";
export { i18nKey } from "./tree/model";
// The hooks over @jsudc/core's client, the client context and the TanStack Query client.
export {
  ALL_ROWS_MAX,
  type FetchAllRowsArgs,
  fetchAllRows,
  freshnessOf,
  pageOffset,
  patchRowInList,
  pollInterval,
  type UdcAllRowsResult,
  type UdcCollectionResult,
  type UdcMutateVars,
  type UseUdcAllRowsArgs,
  type UseUdcCollectionArgs,
  useUdcAllRows,
  useUdcCollection,
  useUdcCollections,
  useUdcDescribe,
  useUdcMutate,
  useUdcSchema,
  useUdcSource,
} from "./udc/hooks";
export { type ListKeyParams, type PagingMode, udcKeys } from "./udc/keys";
export { createUdcQueryClient, shouldRetry, UdcProvider, useUdcClient } from "./udc/provider";
