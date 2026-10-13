import { expect, test } from "vitest";

import { PACKAGE_NAME } from "../src/index";

test("package name is dsh-llm-account", () => {
  expect(PACKAGE_NAME).toBe("dsh-llm-account");
});
