import { expect, test } from "bun:test";
import { getModelLabel } from "../../lib/modelCatalog.ts";

test("frontend model labels come from the projected operator catalog", () => {
  const models = [{ id: "operator/model", label: "Operator Model" }];

  expect(getModelLabel(models, "operator/model")).toBe("Operator Model");
  expect(getModelLabel(models, "unknown-model")).toBe("unknown-model");
});
