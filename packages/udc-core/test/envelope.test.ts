import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  ErrorPayloadSchema,
  errKind,
  isVersionConflict,
  okKind,
  parseKind,
  requestKind,
  UdcError,
} from "../src/index.js";

describe("envelope", () => {
  it("builds kinds", () => {
    expect(requestKind("list")).toBe("udc.list");
    expect(okKind("schema.add_field")).toBe("udc.schema.add_field.ok");
    expect(errKind("describe")).toBe("udc.describe.err");
  });

  it("parses kinds back", () => {
    expect(parseKind("udc.schema.add_field.ok")).toEqual({
      action: "schema.add_field",
      status: "ok",
    });
    expect(parseKind("udc.list.err")).toEqual({ action: "list", status: "err" });
    expect(parseKind("udc.read")).toEqual({ action: "read", status: "request" });
    expect(parseKind("other.read")).toBeNull();
    expect(parseKind("udc.")).toBeNull();
  });

  it("has the closed error code set", () => {
    expect([...ERROR_CODES].sort()).toEqual(
      [
        "forbidden",
        "internal",
        "not_found",
        "unsupported_op",
        "validation_error",
        "version_conflict",
      ].sort(),
    );
    expect(ErrorPayloadSchema.safeParse({ code: "config_syntax", message: "x" }).success).toBe(
      false,
    );
  });

  it("UdcError round-trips through its payload", () => {
    const err = new UdcError("version_conflict", "stale", { current_version: 3 });
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("UdcError");
    expect(isVersionConflict(err)).toBe(true);
    const payload = ErrorPayloadSchema.parse(err.toPayload());
    expect(payload).toEqual({
      code: "version_conflict",
      message: "stale",
      details: { current_version: 3 },
    });
    const back = UdcError.fromPayload(payload);
    expect([back.code, back.message, back.details]).toEqual([err.code, err.message, err.details]);
    expect(new UdcError("internal", "x").toPayload()).toEqual({ code: "internal", message: "x" });
  });
});
