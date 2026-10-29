Copies of `view.yaml`, `schema.json` and `source.yaml` from the example app's
`backend/collections/`, so the tests that check real-world documents parse
need nothing outside this package. The example's own tests parse the originals;
refresh these copies when a collection there changes shape.
