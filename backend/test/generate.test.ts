import { describe, expect, it } from "vitest";
import { generateCompanies } from "../scripts/generate-companies.js";
import { companiesSeed } from "./helpers.js";

describe("generate-companies", () => {
  it("reproduces the committed seed.json from its default seed", () => {
    expect(generateCompanies(200, 20261018)).toEqual(companiesSeed);
  });
});
