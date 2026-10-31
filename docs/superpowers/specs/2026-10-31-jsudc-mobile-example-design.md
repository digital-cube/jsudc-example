# jsudc on React Native: `@jsudc/react-native` and the mobile example, first screen

Status: design, agreed by Igor in the Root chat on 2026-10-31; the plan and the
tickets come after this document. Written from the repository root at `6cedc22`,
against `@jsudc/react` 0.2.0 as installed in `frontend/node_modules`.

## 1. Intent

The libraries plan (`2026-10-29-jsudc-libraries-plan.md` §5, phase 2) names two
pieces: **T11** `@jsudc/react-native`, the UDC view layer for React Native, and
**T12** `jsudc-mobile-example`, an Expo app over the same backend as the web
example. Both start here, with **one screen**: the Serbian companies collection
(`companies`, 200 seed rows), the same collection the web example opened with.

The mobile example is meant to grow into the mobile counterpart of
`jsudc-example`: every collection the web app shows, each one adapted to a
phone. This document covers the first screen only, and the pieces of the
library that screen needs. Later screens are later documents.

Why now: the web stack is public and deployed (`jsudc.dev`,
`examples.jsudc.dev`), and the headless layer of `@jsudc/react` already exists
on a subpath with no DOM in it (see §4). The mobile library can be built on
what is there instead of duplicating the hooks.

## 2. Goals, non-goals, anti-goals

**Goals**

- A phone user opens the app, taps "Srpske firme" and gets a scrollable list of
  company cards from the live backend, can search, filter and sort, and can
  switch to a table.
- `@jsudc/react-native` exists as a real package: the cards and table
  renderers, the search box, the filter sheet and chips, a data-view state
  hook for RN, built on `@jsudc/react/headless` and `@jsudc/core`.
- The same code runs on Igor's Mac (iOS simulator) and on the Android emulator
  on the dev VM, where a ticket session verifies it with screenshots.

**Non-goals (this round)**

- Editing. The web example edits inline; the first mobile screen is read-only.
- The map renderer. `react-native-maps` needs a Google Play system image and an
  API key on the emulator; it is a later screen.
- Kanban, calendar, tree, chart, the schema editor.
- Offline, auth, push, a store release.
- Angular, MUI/Ant kits (other phase-2 items).

**Anti-goals**

- A second copy of the hooks. If something in `@jsudc/react/headless` does not
  work in RN, fix it there (a small PR on `jsudc-react`), do not fork it.
- A web page in a WebView.
- A mobile library that imports `react-dom`, `window`, `document` or
  `localStorage` anywhere.

## 3. What a user sees

**Home.** A plain list of examples, one entry for now: "Srpske firme" with a
one-line description. The list is the growth point for later screens.

**Srpske firme.** One screen, top to bottom:

1. A header with the title and, on the right, a cards/table toggle.
2. A search field (`search.fields` from `view.yaml`: name, PIB, MB, city;
   placeholder from the view).
3. A row of chips: one chip per active filter (tap to remove), plus a
   "Filters" chip that opens the filter sheet; a sort chip showing the current
   sort.
4. The list.

**Cards** (default on phones). One card per company, from `card_options`:
title `name` (titlecased, as the column transform says), subtitle `pib`, then
the meta fields `city`, `industry`, `employees`, `revenue_eur` (both numbers
formatted with `number_format`), `active` as a check/cross. `website` is in
`meta_fields` but not in the schema; the card leaves it out exactly as the web
card does, and shows it when someone adds the field. Inactive companies get the
muted accent (`row_color` rule), the same rule the web applies. The list is a
`FlatList` with pull-to-refresh and infinite paging (`pagination: infinite`,
50 per page).

**Table.** Horizontal scroll, the columns of `view.yaml` in order with their
widths, `pib` and `name` pinned left, right-aligned numbers, the date transform
`DD.MM.YYYY`, the bool renderer. Rows are 48 high. Tap a column header to sort
(asc, desc, off). The table is the default renderer on wide screens
(§5, breakpoint). It is the view's `default_renderer`, but on a phone the
card is the better default, so the mobile library lets the host override
the default per screen width.

**Filter sheet.** A bottom sheet with the four filters from `view.yaml`: city
and industry as pickers over the listed options, active as a three-state
toggle (any / yes / no), employees as a range slider 0–5000 step 50. "Apply"
and "Clear". Applying closes the sheet and the chips update.

**Sort.** A sort chip opens a small picker over the sortable columns of the
view (those with `index: true` in the schema are the sensible set; the view's
`filterable.fields` is the list to use).

**Empty and error states.** "No companies match" with a "Clear filters"
button; a network error shows the message and a retry.

## 4. How it is built

### 4.1 Repositories and packages

| what | where | package |
|---|---|---|
| the library | `digital-cube/jsudc-react-native` (exists, private, empty; make it public like the others when the first release lands) | `@jsudc/react-native` |
| the example | `digital-cube/jsudc-mobile-example` (to be created, public) | the Expo app |

Both follow the conventions of the sibling repositories: MIT, `CHANGELOG.md`
with an `## Unreleased` section, Biome, Vitest, `exports` map with `types`
first, release by tag through the same workflow as `jsudc-react`. Work happens
the way the react tickets did: a clone under `libs/<repo>` inside the
`jsudc` worktree, a branch, a PR, a NON-AI merge ticket for Igor.

### 4.2 Reuse: what the headless layer already gives

Checked on 0.2.0 (`frontend/node_modules/@jsudc/react/dist`):

- `@jsudc/react/headless` exports the hooks `useUdcCollections`,
  `useUdcDescribe`, `useUdcCollection` (list with paging), `useUdcAllRows`,
  `useUdcMutate`, `useUdcSchema`; `UdcClientContext`, `useUdcClient`,
  `createUdcQueryClient`; `useDataViewState`; the filter composition
  (`compose`), the URL-state codecs (`urlState`), `cardSlots` and the card
  model, `format`/`transforms` for cell values, the renderer registry and
  context.
- Those modules import only `react`, `@tanstack/react-query` and
  `@jsudc/core`. No `react-dom`, no DOM API, in any of them.
- Two seams touch the browser: `url-state/adapter.js` (`windowLocationAdapter`,
  guarded by `typeof window === "undefined"`) and `lib/storage.js`
  (`localStorage` that never throws). `useDataViewState` reads both through
  the `UrlStateAdapter` interface and that storage helper.
- `@jsudc/core/client` is `UdcClient` over `fetch`; RN has `fetch`.
  `crypto.randomUUID` and `Intl.supportedValuesOf` are optional there.

**Web-platform globals (builder check, my call).** The headless state code
uses `URLSearchParams` (mutated: `get`/`set`/`delete`) and, in the filter
codec of `urlState.js`, `TextEncoder`, `TextDecoder("utf-8", {fatal: true})`,
`btoa` and `atob`. These are not DOM, but they are not guaranteed on Hermes
either: bare React Native's `URLSearchParams` throws on `set`, while Expo
ships its own `URL`/`URLSearchParams` and `TextEncoder`/`TextDecoder`
(UTF-8 only; `fatal` is not documented). Decision: **0.1.0 of the mobile
library targets Expo** (the platform chosen for the example) and says so in
its README; it does not add polyfill peers and does not rewrite the codec in
`jsudc-react`. Two guards go with that: a runtime smoke test in the library
(a filter round trip through the codec and a `URLSearchParams` mutation,
run on the emulator by the example's verification, not only under Node), and
a line in the README naming `react-native-url-polyfill` and a text-encoding
shim as what a bare-RN host would add. If the codec's `fatal` path turns
out not to hold on Hermes, the codec gets a `try`-free decode in a later
`jsudc-react` patch; that is not assumed here.

So the mobile library **imports the hooks and models from
`@jsudc/react/headless`** and adds only what RN needs:

- an in-memory `UrlStateAdapter` (the "URL" is the screen's state; a host
  with Expo Router may map it to route params later, not now). The adapter
  is created with initial params, which is how the mobile hook seeds
  `tab=cards` on a phone: `useDataViewState` resolves the renderer from the
  params first and falls back to the view's `default_renderer` (`table` for
  companies), and `opts.defaultRenderer` of the mobile hook becomes that
  seed. No change to the web hook for this.
- a storage adapter for the paging mode and the renderer choice.
  `useDataViewState` reads storage **synchronously during render** through
  the module-level `lib/storage.js` (`localStorage`), so AsyncStorage cannot
  be dropped in. Decision: the injected interface stays sync `{get, set}`;
  the mobile wrapper preloads the collection's keys from
  `@react-native-async-storage/async-storage` into memory once, the screen
  renders a placeholder until that hydration resolves (one frame on a warm
  cache), and writes go through to AsyncStorage. The renderer choice is not
  persisted by the web hook at all (only the paging mode is; the tab lives
  in the params), so the mobile hook persists the tab itself: it writes the
  chosen tab under its own key on change and uses it as the seed above.

**The `jsudc-react` patch (ticket 2), full scope — one PR, one merge, one
patch release.** Reading `useDataViewState` against the above gives four
small seams, all in the same hook or its package manifest, so they ship
together rather than as four merges:

1. `useDataViewState(collection, view, opts)` accepts `opts.storage`
   (`{get(key): string | null; set(key, value): void}`), default the
   existing `localStorage` helper.
2. `opts.renderers` is typed today as the web `RendererRegistry` (each entry
   with a `component` and a Lucide `icon`); the hook only needs the names.
   Loosen it to a minimal shape (`{ [name]: unknown }` or a `string[]`),
   keeping the registry assignable.
3. Export the dictionary and its helpers on a subpath `@jsudc/react/i18n`
   (the module is DOM-free; today it is reachable only from the root entry,
   which the mobile bundle may not import).
4. `react-dom` becomes an optional peer in `peerDependenciesMeta`; the
   headless subpath never needs it.

Until that patch is released the mobile library develops against the branch
build in `libs/jsudc-react` and must still not break on a missing
`localStorage` (the helper already swallows errors, so it does not).

`@jsudc/react` stays a dependency of the mobile library only through its
`headless` and `i18n` subpaths; the build has a test asserting the mobile
bundle imports nothing else from `@jsudc/react`, and nothing from `react-dom`.

### 4.3 The mobile library, first cut

`@jsudc/react-native` 0.1.0 exports:

- `UdcProvider` (client + query client; same props as the react one where
  they make sense: `baseUrl`, `fetch`, `headers`).
- `useMobileDataViewState(collection, view, opts)` — `useDataViewState` with
  the in-memory adapter and the AsyncStorage storage wired in (hydration as
  in §4.2); `opts.defaultRenderer` seeds the tab and overrides the view's
  default; the chosen tab is persisted per collection by this hook.
- `UdcSearch`, `UdcFilterChips`, `UdcFilterSheet`, `UdcSortPicker`.
- `UdcCards` (FlatList) and `UdcTable` (horizontal ScrollView + FlatList for
  rows), each taking the state from the hook and `view`/`schema` from
  `useUdcDescribe`.
- `UdcDataView` — the composition of the above: header toggle, search, chips,
  the active renderer; `renderers` prop limits which are offered.
- A theme object (colours, spacing, radius, font) with the same names as
  `tokens.css` where they overlap, so the Acme restyle of the web example can
  be repeated on mobile later. Styling with `StyleSheet`; no Tailwind-for-RN,
  no UI kit dependency in 0.1.0.
- i18n: the dictionary from the `@jsudc/react/i18n` subpath (ticket 2) for
  the strings the screen shares with the web; the mobile-only strings
  (sheet, sort picker) in the same format, English and Serbian.

Peers: `react`, `react-native`, `@jsudc/core`, `@jsudc/react` (headless),
`@tanstack/react-query`, `@react-native-async-storage/async-storage`. The
sheet and the slider: `@gorhom/bottom-sheet` and
`@react-native-community/slider` as optional peers behind the filter sheet
(the sheet is a subpath `@jsudc/react-native/filter-sheet`), so a host that
builds its own filter UI installs neither. Everything else is RN core.

Build: `tsc` to `dist/` (ESM + `.d.ts`), the RN Metro resolver reads the
TypeScript-compiled JS; no native code in the package.

### 4.4 The example app

Expo SDK current stable, TypeScript, Expo Router for the two screens (home,
companies). Backend URL from `EXPO_PUBLIC_UDC_URL`, default
`https://examples.stage.jsudc.dev` (the stage example, HMR stack); production
`https://examples.jsudc.dev` is a one-variable change. The app calls
`POST /udc/*` on that origin exactly as the web app does; the stage nginx
already proxies it.

Screens use `UdcDataView` from the library with `renderers={["cards","table"]}`
and `defaultRenderer` from the width rule in §5. The home screen is a static
list.

README: how to run on iOS (Igor's Mac: `npx expo run:ios` or Expo Go), on the
Android emulator (the VM, §6), and against a local backend.

### 4.5 Breakpoint

The host chooses the default renderer by `useWindowDimensions().width`:
cards below 600 dp, table at 600 dp and up (tablets, large phones in
landscape). The toggle in the header overrides it; the choice persists per
collection through the storage adapter. 600 dp is my call (Igor's words were
"tablets or some larger phones"); the builder may adjust after seeing it on
the emulator.

## 5. Environment: Android on the dev VM

Checked 2026-10-31 on `igor.digitalcube.work` (the VM this chat runs on):

| item | state |
|---|---|
| CPU / RAM / disk | 48 cores (AMD, `kvm_amd` loaded), 31 GB (13 free), 88 GB free |
| `/dev/kvm` | present, opens; user `digital` is **not** in group `kvm` (`usermod -aG kvm digital`) |
| GPU | none; the emulator runs `-no-window -gpu swiftshader_indirect` |
| Java | none; `openjdk-17-jdk-headless` available in apt (26.04) |
| Android SDK | none; `ANDROID_HOME` unset |
| Node | nvm 22.23.2, 24.15.0, 24.19.0 |
| Xvfb | present (not needed with `-no-window`) |

One-time setup (a NON-AI ticket, or done from the Root chat which has sudo):
`openjdk-17-jdk-headless`, Android command-line tools under
`~/Android/Sdk`, `sdkmanager "platform-tools" "emulator" "platforms;android-35"
"build-tools;35.0.0" "system-images;android-35;google_apis;x86_64"`, an AVD
`jsudc` (Pixel 7 profile, 4 GB RAM, 2 cores), `ANDROID_HOME` and the SDK on
`PATH` in `~/.profile` so ticket sessions inherit it, `digital` in `kvm`.
About 15 GB. Verification of the setup itself: the emulator boots headless to
`sys.boot_completed=1` within two minutes and `adb exec-out screencap -p`
returns a PNG.

Ticket sessions verify the app the same way: start the emulator headless,
`npx expo run:android` (or `expo start --android` with the dev client), wait
for the screen, `adb screencap`, attach the PNGs to the ticket. The
`thilo-browser-verify` skill is for Chrome; for this app the evidence is the
emulator screenshot, named the same way (`01-home.png`, `02-cards.png`,
`03-table.png`, `04-filter-sheet.png`).

iOS stays on Igor's Mac: nothing in this design assumes a Mac on the VM.

## 6. Verification of the whole

- Library: `typecheck`, `lint`, unit tests for the adapters, the width rule,
  the chip and sort models; the "no DOM, only headless" bundle test.
- Example: typecheck, lint; on the Android emulator the four screenshots
  above, taken against `examples.stage.jsudc.dev`; the companies list shows
  200 rows across 4 pages, the search for "Novi Sad" narrows the chips and
  the list, a city filter and the employees range narrow it further, sort by
  `employees` desc puts Beograd's largest companies first, the table shows
  the same filtered set with the pinned columns.
- Igor runs it on iOS and says whether the cards read right.

## 7. What is left to the builder

- The exact card layout (which meta field goes where, icons or labels), within
  the slots of `cardSlots(view)`.
- The table's pinned-column implementation in RN (two synchronised lists or
  one wide row), as long as `pib` and `name` stay visible while scrolling.
- Whether the sheet library is `@gorhom/bottom-sheet` or a plain `Modal`
  first; the subpath boundary is what matters.
- The i18n plumbing (reuse the react dictionary format).
- Expo SDK version and whether a dev client is needed (it is not, unless a
  native peer forces it; the slider and the sheet have Expo-compatible
  builds).

## 8. Tickets (proposed, not filed)

In order, all on the `jsudc` worktree with `libs/` clones as the react
tickets did:

1. **Android emulator on the dev VM** — NON-AI (or Root chat): the setup in
   §5, verified by a headless boot and a screencap.
2. **`jsudc-react`: injectable storage for `useDataViewState`** — small PR,
   patch release 0.2.2 (or whatever is next); the merge is a NON-AI ticket.
3. **`@jsudc/react-native` 0.1.0** — §4.3, in `jsudc-react-native`, PR; a
   NON-AI merge ticket; release by tag.
4. **`jsudc-mobile-example`: home + Srpske firme** — §4.4, §4.5, in a new
   repository; the four emulator screenshots on the ticket; Igor's iOS run
   is the review.

3 can start on the unreleased 2 by installing the branch build; 4 needs 3
published (or a `file:` link to the `libs/` build while developing, as the
example did with the react library before its first release).
