# Files

The rows of this collection are **files on disk**, not database rows: the
entries of one folder of `backend/collections/files/sample/`, read when you
open it. Nothing is stored, nothing can be edited.

- **Folders first.** Click a folder (or `..`) to open it. The open folder is a
  `path eq <folder>` condition in the filter of the URL (`?f=`), so a link to a
  subfolder opens that subfolder, and the breadcrumb above the table is that
  condition.
- **Search and chips work inside the folder.** *Ext = md* lists the markdown
  files of the open folder; the search box matches names.
- **Sizes and dates** come from the file system: `size` is shown in bytes,
  KB or MB, `mtime` as the last modification.
- **Preview.** A click on a text or image file opens it (up to 256 KB).

Point the collection at another folder with `UDC_FILES_ROOT=/some/path` in
the backend's environment. Paths outside the root are refused, symlinks are
not followed.
