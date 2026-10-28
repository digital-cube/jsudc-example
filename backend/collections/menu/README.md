# Menu — the sidebar, as a collection

The sidebar to the left of this page is not hard-coded. It is this
collection, drawn as chrome: the frontend lists every row of `menu`, builds
the tree in the browser and draws each node as a link. Open the **Tree**
tab and you see the same nodes drawn as data; the **Table** tab shows the
columns the tree is built from; the **Source** tab shows the file they all
come from, `menu/data/menu.yaml`.

Edit that file, reload the page, and the sidebar has changed. Nothing is
compiled and nothing is seeded: the backend re-reads the YAML on the first
request after its modification time moves.

## From nested YAML to flat rows

The file is a nested list — a node may have `children`. A tree renderer
wants flat rows that each know their place, so the `yaml_menu` source
flattens it, depth first, in the order the file is written:

| Column | What it holds |
|---|---|
| `code` | as written; unique among its siblings |
| `translation_key` | `<SECTION>_<TERM>`, shown as `t(section, term)` (`MENU_HOME` → *Home*) |
| `icon` | `lucide:<name>`, resolved to a lucide icon (a circle when unknown) |
| `url` | the route a click opens; a node without one only groups others |
| `parent_id` | the parent's id; empty on the roots |
| `order` | the position among its siblings, from 0 |
| `depth` | 0 on the roots |
| `ancestor_ids` | the ids from the root down to the parent |
| `children_count` | how many children it has, resolved ones included |
| `is_dynamic` | true on the rows a reference added (below) |

The rows are fixed, so the collection has no `schema.json` (a menu that
ships one must agree with `MENU_SCHEMA`, or the server will not start).

## Ids come from the path

A node's id is the sha1 of the path of codes from the root —
`COLLECTIONS/DATABASE`, `VIEWS/TICKETS_KANBAN`. Nothing is stored, so the
id must be derived, and the path is what stays put while a person edits:
move two leaves past each other and both keep their ids (only `order`
changes), so the sidebar keeps what you had expanded. Rename a code, or
move a node under another parent, and it is a new node with a new id.

## The branch nobody wrote

Three nodes under **Collections** do not list their children. They name
them:

```yaml
- code: DATABASE
  translation_key: MENU_DATABASE
  children: "udc:collections?group=database"
```

On every read the source asks the server's own collection registry for
the collections of that group (`database`, `files` or `internet`; leave out
`?group=` for all of them) and splices one leaf per collection in place of
the string: `code` `COLLECTION_<NAME>`, `translation_key`
`COLLECTIONS_<NAME>`, `url` `/udc/<name>`, the icon from
`collection_icons` in `source.yaml`. Those rows carry `is_dynamic: true` —
the ticked column on the Table tab, tinted by `row_color`. Add a
collection directory, restart the server, and it is in the menu without
an edit here.

The reference is resolved inside the server, not over HTTP: the registry
is right there. The older `api:<path>` form, which made the source call
its own HTTP endpoint, is refused at startup with a message saying so.

## When the file is wrong

A missing file or one that does not parse stops the server at startup,
naming the file. A file that breaks while the server runs does not take
the sidebar down: the source keeps serving the last good read, marked
`stale`, and the Source tab shows the error next to the text.
