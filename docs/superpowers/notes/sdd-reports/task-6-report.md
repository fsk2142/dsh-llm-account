# Task 6 Report — 目录可见性规则

**Status:** DONE
**Branch:** `work`
**Commit:** `90f05b0` — `feat(core): model visibility rules`

## What I implemented

Created `src/core/catalog.ts` (pure functions, no I/O, no classes, only `import type { CatalogEntry } from "./adapter"`):

- `Visibility` — `{ visibleModels?: string[]; modelVisibility?: Record<string, boolean> }`, defined and exported here (did not touch `src/core/adapter.ts`).
- `isModelVisible(entry: CatalogEntry, visibility: Visibility): boolean`
- `selectVisible(entries: CatalogEntry[], visibility: Visibility): CatalogEntry[]`
- `normalizeVisibility(raw: unknown): Visibility`

### The exact precedence expression

Three rules as an explicit ordered branch sequence, each branch short-circuiting into its own `return` — no nested ternary, so the order is readable and cannot drift with condition order:

```ts
export function isModelVisible(entry: CatalogEntry, visibility: Visibility): boolean {
  // 规则 1：显式布尔覆盖优先于白名单——`false` 也必须生效，故判 `undefined` 而非真值。
  const override = visibility.modelVisibility?.[entry.id];
  if (override !== undefined) return override;

  // 规则 2：白名单非空时，只有名单内的模型可见。
  const allow = visibility.visibleModels;
  if (allow !== undefined && allow.length > 0) return allow.includes(entry.id);

  // 规则 3：白名单缺省或为空——全部可见。
  return true;
}
```

Rule 1 keys on `override !== undefined` rather than truthiness, so an explicit `false` wins over a whitelist hit (this is the first brief test).

### normalizeVisibility contract

- Non-record input (`null`, string, number, array) → `{}` (no restriction).
- `visibleModels`: kept only when the raw value is an array; every non-string element is dropped.
- `modelVisibility`: kept only when the raw value is a plain object; only boolean-valued pairs survive, and the whole field is omitted when nothing valid remains (`normalizeVisibility({ m: "yes" })` → `{}`, per the brief).
- Never mutates its input; `selectVisible` uses `Array.prototype.filter`, so it returns a new array, preserves input order, and leaves the caller's array untouched.

## What I tested

`tests/core/catalog.test.ts` — 12 tests:

| # | Test | Why it matters |
|---|------|----------------|
| 1 | 显式布尔覆盖优先于白名单 | Brief's exact assertions (override hides a whitelisted model; override shows a model outside an empty whitelist) |
| 2 | 白名单为空表示显示全部 | Brief's assertion (rule 3) |
| 3 | 非布尔值被忽略 | Brief's assertion (`{ m: "yes" }` → `{}`) |
| 4 | 未提供可见性时显示全部 | Empty `Visibility` default path |
| 5 | 白名单非空时，不在名单内的模型隐藏 | Rule 2 negative case (non-member hidden) |
| 6 | **Extra test required by the brief:** `normalizeVisibility` 丢弃 `visibleModels` 中的非字符串元素 | `["a", 7, null, undefined, {}, "b"]` → `["a", "b"]` |
| 7 | `normalizeVisibility` 只保留 `modelVisibility` 中的布尔键值对 | `{ a: true, b: false, c: "yes", d: 0 }` → `{ a: true, b: false }` |
| 8 | `normalizeVisibility` 对非对象输入返回空可见性 | `undefined`/`null`/`"m"`/`42`/`["m"]` → `{}` |
| 9 | `normalizeVisibility` 丢弃形状不合法的字段，保留合法字段 | Per-field independence |
| 10 | `selectVisible` 过滤结果保持输入顺序且不修改入参 | Pins order (`["c","a"]` whitelist → `["a","c"]` output), new array identity, and input immutability against a `slice()` snapshot |
| 11 | `selectVisible` 在覆盖与白名单组合下按同一规则逐条判定 | `[a,b,c,d]` + `{ visibleModels: ["a","b"], modelVisibility: { a: false, c: true } }` → `["b","c"]` |
| 12 | `selectVisible` 在无可见性约束时返回全部条目 | Pass-through path |

## TDD evidence

**RED** — `pnpm vitest run tests/core/catalog.test.ts` (before `src/core/catalog.ts` existed):

```
 ❯ tests/core/catalog.test.ts (0 test)

⎯⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/core/catalog.test.ts [ tests/core/catalog.test.ts ]
Error: Cannot find module '../../src/core/catalog' imported from C:/Work/dsh-llm-account/tests/core/catalog.test.ts
 ❯ tests/core/catalog.test.ts:4:1

 Test Files  1 failed (1)
      Tests  no tests
```

Expected: for a brand-new module this is a module-resolution failure, not an assertion failure — the test file compiles and 0 tests are collected because the import cannot resolve. Matches the brief's Step 2 ("FAIL，模块不存在").

**GREEN** — `pnpm vitest run tests/core/catalog.test.ts` (after implementation):

```
 ✓ tests/core/catalog.test.ts (12 tests) 4ms
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

**Gate before commit** — `pnpm typecheck` → exit 0, no diagnostics. `pnpm test`:

```
 ✓ tests/core/accounts.test.ts (10 tests)
 ✓ tests/core/credentials.test.ts (4 tests)
 ✓ tests/core/catalog.test.ts (12 tests)
 ✓ tests/core/rotation.test.ts (19 tests)
 ✓ tests/core/adapter.test.ts (2 tests)
 ✓ tests/smoke.test.ts (1 test)
 Test Files  6 passed (6)
      Tests  48 passed (48)
```

36 pre-existing tests + 12 new = 48, all green.

## Files changed

- `src/core/catalog.ts` (new)
- `tests/core/catalog.test.ts` (new)

Nothing else touched; no closed module was edited. Commit is a plain new commit (`90f05b0`), no `--amend`.

## Self-review findings

- **Completeness:** all three Produces names present and exported (`isModelVisible`, `selectVisible`, `normalizeVisibility`), `Visibility` exported from `catalog.ts`, required extra test present (test 6).
- **Quality:** precedence is three explicit ordered `if`/`return` branches with the rule number in each comment; no nested ternaries. `override !== undefined` is deliberate and commented, since truthiness would silently drop explicit `false`.
- **Discipline (YAGNI):** no dedupe, no sorting, no caching, no trimming of model ids, no extra options — the brief specifies none of those. `normalizeVisibility` only does what the brief asks (converge untrusted raw values).
- **Testing:** tests assert real returned values, not implementation internals; order preservation, new-array identity, and non-mutation of the input are explicitly pinned.
- **Output pristine:** `pnpm typecheck` clean, 48/48 green, `git status --short` clean after commit. `git ls-files --eol` shows `i/lf w/lf` for both new files, matching every other tracked source file in the repo.
- **Constraints:** `grep` over `catalog.ts` finds no `commandcode`/`opencode` vendor strings and no `any`; the only import is `import type { CatalogEntry } from "./adapter"`.

## Issues or concerns

1. **Deliberate asymmetry in `normalizeVisibility`:** a valid-but-empty `visibleModels` array is preserved (`{ visibleModels: [] }`), while an all-invalid `modelVisibility` object is dropped (`{}`). Behaviorally identical for the three rules (empty whitelist = show all), but it means `normalizeVisibility` is not a canonical form — two `Visibility` values that behave the same can compare unequal. I chose this because the brief only mandates dropping non-booleans from `modelVisibility`, and preserving an explicit empty whitelist is lossless. Flagging it in case Task 9/12 ever compare normalized values with `toEqual` or persist them back.
2. **Whitespace/empty-string model ids are kept** by `normalizeVisibility` (only non-strings are dropped). The brief says "非字符串的元素同样丢弃" and nothing about blank strings, so I did not add trimming. If the settings UI can produce `""` entries, callers should not expect `normalizeVisibility` to prune them.
3. **`Visibility.visibleModels` is `string[]`, not `readonly string[]`** — kept to the shape the brief named. Callers passing `as const` literals or frozen arrays would need a cast; if Task 9/12 hits that, this is the place to widen it.
