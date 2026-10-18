import { expect, it } from "vitest";

import { accountRef, assignModelRule, dedupeByRef, dropAccount, globalOrderOfVendor, moveFirst, reorder } from "../../src/core/accounts";

it("同一模型只属于一个账号：改派给另一账号后旧规则移除", () => {
  const r1 = assignModelRule([], ["m1"], "acc-a");
  const r2 = assignModelRule(r1, ["m1"], "acc-b");
  expect(r2).toEqual([{ models: ["m1"], account: "acc-b" }]);
});

it("删除账号会同时清掉它的模型规则与当前账号标记", () => {
  const state = { order: ["a", "b"], rules: [{ models: ["m1"], account: "b" }], pinned: "b" };
  const next = dropAccount(state, "b");
  expect(next.order).toEqual(["a"]);
  expect(next.rules).toEqual([]);
  expect(next.pinned).toBeNull();
});

it("全局顺序投影：每家只保留自己的键，旧裸 ref 按本厂商处理", () => {
  const global = ["dsh-opencode-go:oc", "commandcode:cc", "commandcode:default", "dsh-opencode-go:oc2"];
  expect(globalOrderOfVendor(["default", "cc"], global, "commandcode")).toEqual(["cc", "default"]);
  expect(globalOrderOfVendor(["oc", "oc2"], global, "dsh-opencode-go")).toEqual(["oc", "oc2"]);
  // 旧文档里的裸 ref 不迁移也能继续用。
  expect(globalOrderOfVendor(["a", "b"], ["b", "a"], "commandcode")).toEqual(["b", "a"]);
  // 另一个厂商的键被过滤掉，未知 ref 也不参与。
  expect(globalOrderOfVendor(["a"], ["dsh-opencode-go:x", "a", "zzz"], "commandcode")).toEqual(["a"]);
});

it("排序把 ref 移到目标位置，越界索引被夹紧", () => {
  expect(reorder(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  expect(reorder(["a", "b", "c"], "a", 99)).toEqual(["b", "c", "a"]);
});

it("重复 ref 只保留第一个（Review Focus 1：同一 key 不重复参与轮换）", () => {
  const views = [
    { ref: "x", label: "1", configured: true, active: true },
    { ref: "x", label: "2", configured: true, active: false },
  ];
  expect(dedupeByRef(views)).toHaveLength(1);
});

it("标签不同但转义后同名：必须得到两个不同的 ref（凭据槽名不得互撞）", () => {
  const spaced = accountRef("commandcode", "Team A");
  const dashed = accountRef("commandcode", "Team-A");
  expect(spaced).not.toBe(dashed);

  // 大小写、首尾空白同样只影响展示，不影响身份。
  expect(accountRef("commandcode", "team a")).not.toBe(spaced);
  expect(accountRef("commandcode", " Team A")).not.toBe(spaced);

  // 同一个标签必须稳定映射到同一个 ref（凭据槽名要能被重新算出来）。
  expect(accountRef("commandcode", "Team A")).toBe(spaced);
  // 同一标签在不同厂商下也必须是两个 ref。
  expect(accountRef("dsh-opencode-go", "Team A")).not.toBe(spaced);
});

it("ref 满足凭据引用名合法字符集，形状为 DSH_LLM_ACCOUNT_<VENDOR>_<LABEL>_<HASH>", () => {
  expect(accountRef("commandcode", "Team A")).toMatch(/^DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_[0-9a-f]{12}$/);
  expect(accountRef("dsh-opencode-go", "Team A")).toMatch(/^DSH_LLM_ACCOUNT_DSH_OPENCODE_GO_TEAM_A_[0-9a-f]{12}$/);

  const wild = [
    accountRef("commandcode", ""),
    accountRef("commandcode", "  "),
    accountRef("commandcode", "team/a@b.c-d:e"),
    accountRef("dsh-opencode-go", "账号·一"),
    accountRef("dsh-opencode-go", "1 2 3"),
    accountRef("commandcode", "🚀 rocket"),
    accountRef("commandcode", "ß-ä-tab\there"),
  ];
  for (const ref of wild) expect(ref).toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
});

it("改派只摘掉被点名的模型：规则里其他模型留在原账号，新规则追加在末尾", () => {
  const rules = [{ models: ["m1", "m2"], account: "a" }];
  expect(assignModelRule(rules, ["m1"], "b")).toEqual([
    { models: ["m2"], account: "a" },
    { models: ["m1"], account: "b" },
  ]);
});

it("删除账号只清目标账号：其他账号的规则与固定标记保留，删除不存在的 ref 是恒等", () => {
  const state = {
    order: ["a", "b"],
    rules: [
      { models: ["m1"], account: "a" },
      { models: ["m2"], account: "b" },
    ],
    pinned: "a",
  };
  const next = dropAccount(state, "b");
  expect(next).toEqual({ order: ["a"], rules: [{ models: ["m1"], account: "a" }], pinned: "a" });
  expect(dropAccount(next, "zzz")).toEqual(next);
});

it("排序：ref 不在列表里时原样返回，负索引夹到开头", () => {
  expect(reorder(["a", "b"], "zzz", 0)).toEqual(["a", "b"]);
  expect(reorder(["a", "b"], "b", -5)).toEqual(["b", "a"]);
});

it("moveFirst：把一项提到首位，其余相对顺序不变；缺项/首位是恒等", () => {
  // 「第一行 = 当前账号」的派生读取（旧插件 moveAccountFirst 同一形状）。
  expect(moveFirst([{ ref: "a" }, { ref: "b" }, { ref: "c" }], "c")).toEqual([{ ref: "c" }, { ref: "a" }, { ref: "b" }]);
  expect(moveFirst([{ ref: "a" }, { ref: "b" }, { ref: "c" }], "b")).toEqual([{ ref: "b" }, { ref: "a" }, { ref: "c" }]);
  // 已经在首位 / 不在表里：原样返回（调用方据此跳过无谓写入）。
  expect(moveFirst([{ ref: "a" }, { ref: "b" }], "a")).toEqual([{ ref: "a" }, { ref: "b" }]);
  expect(moveFirst([{ ref: "a" }, { ref: "b" }], "zzz")).toEqual([{ ref: "a" }, { ref: "b" }]);
  // 入参不被修改。
  const rows = [{ ref: "a" }, { ref: "b" }];
  moveFirst(rows, "b");
  expect(rows).toEqual([{ ref: "a" }, { ref: "b" }]);
});

it("五个函数都是纯函数：不修改入参", () => {
  const views = [{ ref: "x", label: "1", configured: true, active: true }];
  const order = ["a", "b", "c"];
  const rules = [{ models: ["m1", "m2"], account: "a" }];
  const state = { order: ["a", "b"], rules: [{ models: ["m1"], account: "b" }], pinned: "b" };

  accountRef("commandcode", "Team A");
  dedupeByRef(views);
  reorder(order, "c", 0);
  assignModelRule(rules, ["m1"], "b");
  dropAccount(state, "b");

  expect(views).toEqual([{ ref: "x", label: "1", configured: true, active: true }]);
  expect(order).toEqual(["a", "b", "c"]);
  expect(rules).toEqual([{ models: ["m1", "m2"], account: "a" }]);
  expect(state).toEqual({ order: ["a", "b"], rules: [{ models: ["m1"], account: "b" }], pinned: "b" });
});
