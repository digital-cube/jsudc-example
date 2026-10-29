import { type SchemaDoc, SchemaDocSchema } from "@jsudc/core";
import { UdcClient } from "@jsudc/core/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Dialog } from "../src/components/ui/dialog";
import { UdcI18nProvider } from "../src/i18n/i18n";
import { FieldFormDialog, type FieldFormTarget } from "../src/schema-editor/FieldFormDialog";
import {
  DEFAULT_STRING_LENGTH,
  draftFromDef,
  draftToFieldDef,
  emptyDraft,
  type FieldDraft,
  FORM_TYPES,
  nameProblem,
  suggestName,
  typeControls,
  validateDraft,
} from "../src/schema-editor/fieldForm";
import { createUdcQueryClient, UdcProvider } from "../src/udc/provider";
import { mockUdcFetch } from "./fetchMock";

const schema: SchemaDoc = SchemaDocSchema.parse({
  version: "v3",
  fields: {
    name: { type: "string", length: 200, required: true },
    employees: { type: "integer", min: 0 },
    tier: { type: "enum", values: ["a", "b"], description: "kept" },
  },
});

const draft = (patch: Partial<FieldDraft>): FieldDraft => ({ ...emptyDraft(), ...patch });

describe("field form validation", () => {
  it("checks the name with udc-core's rule and against the schema", () => {
    expect(nameProblem("", "add", schema)).toBe("ERR_NAME_REQUIRED");
    expect(nameProblem("Website", "add", schema)).toBe("ERR_NAME_INVALID");
    expect(nameProblem("2nd", "add", schema)).toBe("ERR_NAME_INVALID");
    expect(nameProblem("web-site", "add", schema)).toBe("ERR_NAME_INVALID");
    expect(nameProblem(`a${"b".repeat(63)}`, "add", schema)).toBe("ERR_NAME_INVALID");
    expect(nameProblem("name", "add", schema)).toBe("ERR_NAME_TAKEN");
    expect(nameProblem("website", "add", schema)).toBeNull();
    // Edit mode never complains: the name is read-only there.
    expect(nameProblem("name", "edit", schema)).toBeNull();
  });

  it("accepts a fresh string field with the default length", () => {
    expect(validateDraft(draft({ name: "website" }), "add", schema)).toEqual({});
    expect(emptyDraft().length).toBe(String(DEFAULT_STRING_LENGTH));
  });

  it("asks string fields for a positive whole length", () => {
    expect(validateDraft(draft({ name: "w", length: "" }), "add", schema)).toEqual({
      length: "ERR_LENGTH_REQUIRED",
    });
    expect(validateDraft(draft({ name: "w", length: "0" }), "add", schema).length).toBe(
      "ERR_LENGTH",
    );
    expect(validateDraft(draft({ name: "w", length: "2.5" }), "add", schema).length).toBe(
      "ERR_LENGTH",
    );
  });

  it("checks min and max of numeric types: whole for integer and year, min ≤ max", () => {
    const n = (p: Partial<FieldDraft>) => validateDraft(draft({ name: "n", ...p }), "add", schema);
    expect(n({ type: "integer" })).toEqual({});
    expect(n({ type: "integer", min: "1.5" })).toEqual({ min: "ERR_INTEGER" });
    expect(n({ type: "year", max: "abc" })).toEqual({ max: "ERR_NUMBER" });
    expect(n({ type: "decimal", min: "1.5", max: "2.25" })).toEqual({});
    expect(n({ type: "decimal", min: "3", max: "2" })).toEqual({ max: "ERR_MIN_MAX" });
    // A string field ignores whatever min/max hold.
    expect(n({ type: "string", min: "x" })).toEqual({});
  });

  it("asks enum fields for unique values", () => {
    expect(validateDraft(draft({ name: "e", type: "enum" }), "add", schema)).toEqual({
      values: "ERR_VALUES_REQUIRED",
    });
    expect(
      validateDraft(draft({ name: "e", type: "enum", values: ["a", "a"] }), "add", schema),
    ).toEqual({ values: "ERR_VALUES_DUP" });
  });

  it("offers only the phase-1 types and the controls of each", () => {
    expect(FORM_TYPES).not.toContain("enum");
    expect(FORM_TYPES).toContain("string");
    expect(typeControls("string")).toEqual({ length: true, range: false, values: false });
    expect(typeControls("year")).toEqual({ length: false, range: true, values: false });
    expect(typeControls("enum")).toEqual({ length: false, range: false, values: true });
    expect(typeControls("bool")).toEqual({ length: false, range: false, values: false });
  });
});

describe("draft ↔ fielddef", () => {
  it("writes the labels as {en, sr} and only the controls of the type", () => {
    const def = draftToFieldDef(
      draft({
        name: "website",
        labelEn: " Website ",
        labelSr: "Veb sajt",
        required: true,
        min: "4",
      }),
    );
    expect(def).toEqual({
      type: "string",
      length: DEFAULT_STRING_LENGTH,
      required: true,
      label: { en: "Website", sr: "Veb sajt" },
    });
    expect(draftToFieldDef(draft({ type: "bool", labelEn: "" }))).toEqual({ type: "bool" });
  });

  it("round-trips an existing def and keeps keys the form does not manage", () => {
    const tier = schema.fields.tier;
    if (!tier) throw new Error("fixture");
    const d = draftFromDef("tier", { ...tier, label: "Tier" } as never);
    expect(d).toMatchObject({ name: "tier", type: "enum", labelEn: "Tier", labelSr: "Tier" });
    expect(d.values).toEqual(["a", "b"]);
    const out = draftToFieldDef({ ...d, required: true, labelSr: "Nivo" }, tier);
    expect(out).toEqual({
      type: "enum",
      values: ["a", "b"],
      description: "kept",
      required: true,
      label: { en: "Tier", sr: "Nivo" },
    });
  });

  it("suggests a name from a label", () => {
    expect(suggestName("Web sajt")).toBe("web_sajt");
    expect(suggestName("Đački dom 2")).toBe("djacki_dom_2");
    expect(suggestName("1st place")).toBe("st_place");
  });
});

function renderForm(target: FieldFormTarget, handlers: Parameters<typeof mockUdcFetch>[0] = {}) {
  const mock = mockUdcFetch(handlers);
  const client = new UdcClient({ httpUrl: "http://api", fetch: mock.fetch });
  const onSaved = vi.fn();
  render(
    <UdcProvider client={client}>
      <QueryClientProvider client={createUdcQueryClient()}>
        <UdcI18nProvider>
          <Dialog open>
            <FieldFormDialog
              collection="companies"
              schema={schema}
              target={target}
              fieldLabel={(f) => f}
              onSaved={onSaved}
              onCancel={() => {}}
            />
          </Dialog>
        </UdcI18nProvider>
      </QueryClientProvider>
    </UdcProvider>,
  );
  return { ...mock, onSaved };
}

describe("<FieldFormDialog>", () => {
  it("shows a bad name as the user types and sends nothing on submit", async () => {
    const user = userEvent.setup();
    const { calls, onSaved } = renderForm({ mode: "add", position: { where: "end" } });
    await user.type(screen.getByTestId("field-name"), "Bad Name");
    expect(screen.getByTestId("field-error")).toHaveTextContent(/lowercase letters/i);
    await user.click(screen.getByTestId("field-form-submit"));
    expect(calls).toHaveLength(0);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("refuses a duplicate name and an emptied length", async () => {
    const user = userEvent.setup();
    const { calls } = renderForm({ mode: "add", position: { where: "end" } });
    await user.type(screen.getByTestId("field-name"), "name");
    expect(screen.getByTestId("field-error")).toHaveTextContent(/already exists/i);
    await user.clear(screen.getByTestId("field-name"));
    await user.type(screen.getByTestId("field-name"), "website");
    await user.clear(screen.getByTestId("field-length"));
    await user.click(screen.getByTestId("field-form-submit"));
    expect(screen.getByTestId("field-error")).toHaveTextContent(/max length/i);
    expect(calls).toHaveLength(0);
  });

  it("sends add_field with the position and shows a server refusal inline", async () => {
    const user = userEvent.setup();
    const { calls, onSaved } = renderForm(
      { mode: "add", position: { where: "after", anchor: "name" } },
      {
        "schema.add_field": () => ({
          err: { code: "validation_error", message: "field website already exists (soft-deleted)" },
        }),
      },
    );
    await user.type(screen.getByTestId("field-name"), "website");
    await user.type(screen.getByTestId("field-label-en"), "Website");
    await user.type(screen.getByTestId("field-label-sr"), "Veb sajt");
    await user.click(screen.getByTestId("field-form-submit"));
    await waitFor(() => expect(screen.getByTestId("field-form-error")).toBeInTheDocument());
    expect(screen.getByTestId("field-form-error")).toHaveAttribute("data-code", "validation_error");
    expect(screen.getByTestId("field-form-error")).toHaveTextContent("soft-deleted");
    expect(onSaved).not.toHaveBeenCalled();
    expect(calls[0]).toMatchObject({
      action: "schema.add_field",
      body: {
        collection: "companies",
        name: "website",
        position: { where: "after", anchor: "name" },
        fielddef: {
          type: "string",
          length: DEFAULT_STRING_LENGTH,
          label: { en: "Website", sr: "Veb sajt" },
        },
      },
    });
  });

  it("edit mode locks name and type and sends update_field", async () => {
    const user = userEvent.setup();
    const { calls, onSaved } = renderForm(
      { mode: "edit", field: "employees" },
      {
        "schema.update_field": () => ({ ok: { schema } }),
        describe: () => ({ ok: {} }),
      },
    );
    expect(screen.getByTestId("field-name")).toHaveAttribute("readonly");
    expect(screen.getByTestId("field-type")).toBeDisabled();
    expect(screen.getByTestId("type-locked")).toBeInTheDocument();
    expect(screen.getByTestId("field-min")).toHaveValue(0);
    await user.click(screen.getByTestId("field-required"));
    await user.click(screen.getByTestId("field-form-submit"));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(calls[0]).toMatchObject({
      action: "schema.update_field",
      body: { name: "employees", fielddef: { type: "integer", min: 0, required: true } },
    });
  });
});
