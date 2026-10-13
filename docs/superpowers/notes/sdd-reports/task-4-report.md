# Task 4 Report — 账号库不变量

**Status:** DONE
**Commit:** `d212702` — `feat(core): account book invariants` (new commit; **no amend** was used)
**Branch:** `work` (parent `047c885`)
**Files:** `src/core/accounts.ts` (new), `tests/core/accounts.test.ts` (new) — nothing else touched; working tree clean after commit.

## What I implemented

Five pure functions in `src/core/accounts.ts` (no I/O, no classes, no state, inputs never mutated). The only import is a type-only import of the closed port types:

```ts
import type { AccountState, AccountView, ModelRule, VendorId } from "./adapter";
```

- `accountRef(vendor: VendorId, label: string): string` — derives the account ref (which doubles as the credential slot name) as `DSH_LLM_ACCOUNT_<VENDOR>_<LABEL>_<HASH>`; uppercase + per-character `_` substitution for both vendor and label, plus a 12-hex-char (48-bit) suffix of a 64-bit FNV-1a hash over the **raw** `(vendor, label)`. Hash over raw input is what makes two labels that escape to the same base name still yield two different refs.
- `dedupeByRef(views: AccountView[]): AccountView[]` — keeps the **first** occurrence of each `ref` (no merging of fields), preserves relative order, returns a new array.
- `reorder(order: string[], ref: string, toIndex: number): string[]` — removes `ref` and re-inserts it so its **final** index is `toIndex`, clamped to `[0, order.length - 1]` (i.e. clamped to both ends). `ref` not present ⇒ value-equal copy, no change.
- `assignModelRule(rules: ModelRule[], models: string[], account: string): ModelRule[]` — strips each named model out of every existing rule (rules emptied by the strip are dropped entirely), then appends one new `{ models, account }` rule at the end ⇒ a model belongs to exactly one account at a time. Empty `models` only strips, it never creates an empty rule.
- `dropAccount(state: AccountState, ref: string): AccountState` — removes every occurrence of `ref` from `order`, drops every rule whose `account` is `ref`, and sets `pinned` to `null` when (and only when) `pinned === ref`. Dropping an absent ref is the identity.

Identity space per the controller note: every `ref` parameter, `ModelRule.account`, `AccountState.order` elements and `AccountState.pinned` live in the same ref space (`accountRef()` output or a hand-written credential reference name). `label` is display-only and is never compared anywhere in this module. `src/core/adapter.ts` was **not** edited.

## The label → ref rule, with worked examples

1. `escape(text) = text.toUpperCase().replace(/[^A-Z0-9_]/g, "_")` — per character, no folding of consecutive underscores (folding loses information and makes distinct labels more likely to collide, not less).
2. `suffix = FNV1a64(vendor + "\u0000" + label).toString(16).padStart(16, "0").slice(0, 12)` — the NUL separator prevents `("a","bc")` and `("ab","c")` from feeding the hash the same bytes.
3. `ref = "DSH_LLM_ACCOUNT_" + escape(vendor) + "_" + escape(label) + "_" + suffix`.

Worked example — `accountRef("commandcode", "Team A")`:

```
escape("commandcode") = "COMMANDCODE"
escape("Team A")      = "TEAM_A"          (space → _)
FNV1a64("commandcode\0Team A") → 12 hex prefix = "a236090ddb39"
ref = DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a236090ddb39
```

Base-name collision requirement, same vendor:

```
"Team A" → DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a236090ddb39
"Team-A" → DSH_LLM_ACCOUNT_COMMANDCODE_TEAM_A_a247050ddb48   (same escaped base: TEAM_A; different ref)
```

Character-set requirement: `escape()` output is a subset of `[A-Z0-9_]` (uppercase can only produce chars that the regex already permits, everything else becomes `_`), the literal prefix starts with the letter `D`, and the suffix is lowercase hex — so the result always matches `^[A-Za-z_][A-Za-z0-9_]*$`. Checked by test and by the 40,000-sample run below.

## TDD evidence

### RED — `pnpm vitest run tests/core/accounts.test.ts` (before the implementation existed)

```
 FAIL  tests/core/accounts.test.ts [ tests/core/accounts.test.ts ]
Error: Cannot find module '../../src/core/accounts' imported from C:/Work/dsh-llm-account/tests/core/accounts.test.ts
 ❯ tests/core/accounts.test.ts:3:1
 Test Files  1 failed (1)
      Tests  no tests
EXITCODE=1
```

Why this failure is the expected one: brief Step 2 says "FAIL，模块不存在" — the module had not been written yet, so vitest failed at import resolution and ran **0 tests**. Nothing passed accidentally; the suite only started executing once `src/core/accounts.ts` existed.

### GREEN — `pnpm vitest run tests/core/accounts.test.ts` (after the implementation)

```
 ✓ tests/core/accounts.test.ts (10 tests) 5ms
 Test Files  1 passed (1)
      Tests  10 passed (10)
EXITCODE=0
```

### Pre-commit gate — `pnpm typecheck && pnpm test`

```
$ tsc --noEmit
TYPECHECK_EXIT=0
 ✓ tests/smoke.test.ts (1 test) 4ms
 ✓ tests/core/adapter.test.ts (2 tests) 2ms
 ✓ tests/core/credentials.test.ts (4 tests) 3ms
 ✓ tests/core/accounts.test.ts (10 tests) 6ms
 Test Files  4 passed (4)
      Tests  17 passed (17)
TEST_EXIT=0
```

Output is pristine: no warnings, no unhandled errors, no `any`, no unused symbols. Re-run once more after the final test-file edit — same result (17/17, typecheck exit 0) — and the commit was made only after that run.

## What I tested

`tests/core/accounts.test.ts`, 10 tests. The four brief tests are verbatim (including their Chinese names):

1. 同一模型只属于一个账号：改派给另一账号后旧规则移除 — the brief's exact assertions.
2. 删除账号会同时清掉它的模型规则与当前账号标记 — the brief's exact assertions.
3. 排序把 ref 移到目标位置，越界索引被夹紧 — the brief's exact assertions.
4. 重复 ref 只保留第一个（Review Focus 1） — the brief's exact assertion.

Six of my own, the first being the one the brief requires:

5. **标签不同但转义后同名：必须得到两个不同的 ref（凭据槽名不得互撞）** — the required extra test. `"Team A"` vs `"Team-A"` (both escape to `TEAM_A`) ⇒ different refs; also `"team a"` and `" Team A"` differ from `"Team A"`; same label ⇒ same ref (stability); same label under the other vendor ⇒ different ref.
6. ref 满足凭据引用名合法字符集，形状为 `DSH_LLM_ACCOUNT_<VENDOR>_<LABEL>_<HASH>` — asserts the exact shape for both vendors, then regex-checks the charset for a set of hostile labels: `""`, `"  "`, `"team/a@b.c-d:e"`, `"账号·一"`, `"1 2 3"`, `"🚀 rocket"` (astral char → surrogate pair), `"ß-ä-tab\there"` (non-ASCII uppercase + control char).
7. 改派只摘掉被点名的模型 — `[{m1,m2}→a]` + assign `[m1]→b` ⇒ `[{m2}→a, {m1}→b]`: partial strip, other model and rule order preserved, new rule appended last.
8. 删除账号只清目标账号 — dropping `b` keeps `a`'s rule and keeps `pinned: "a"`; dropping an absent ref is the identity.
9. 排序：ref 不在列表里时原样返回，负索引夹到开头 — documents the absent-ref no-op and negative clamping to index 0.
10. 五个函数都是纯函数：不修改入参 — calls all five on live objects, then deep-compares the inputs against their originals.

Extra empirical check (throwaway `node --input-type=module` run against the committed module, no file left behind): 20,000 escaping-colliding label pairs (`A-<i>` vs `A_<i>`, both escaping to `A_<i>`) under `commandcode` ⇒ 40,000 refs, **40,000 distinct, 0 collisions, 0 charset violations**:

```
{"totalChecked":40000,"distinct":40000,"charsetViolations":0,"collisions":0}
```

Not part of the committed suite — evidence only.

## Files changed

| File | Change |
| --- | --- |
| `src/core/accounts.ts` | new, 134 lines (5 functions + 2 private helpers + JSDoc) |
| `tests/core/accounts.test.ts` | new, 106 lines (10 tests) |

`git show --stat d212702` ⇒ `2 files changed, 240 insertions(+)`; `git status --short` after the commit is empty. No other file was modified; `src/core/adapter.ts` untouched.

## Self-review findings

- **Completeness.** All five Produces functions exist with the exact signatures from the brief's Interfaces list, plus the required extra collision test. `import type` only; no runtime import from `./adapter`; `src/core/` still contains no vendor words (checked with a case-insensitive search: the only hit in `src/core/` is the allowed `VendorId` union in `adapter.ts`).
- **Quality / naming.** Names state what they do (`escapeText`, `hashText`, plus the five exported names fixed by the brief). JSDoc on every exported function records the decisions a caller cannot infer: "first occurrence wins", "`toIndex` is the final index", "absent ref is a no-op", "rules are stripped then appended, never merged", "ref not label is identity".
- **Discipline (YAGNI).** No configuration object, no class, no cache, no registry, no validation layer, no dependency. Internal choices were resolved in the direction of *fewer* moving parts: no trimming or case-folding of labels (so two labels differing only by whitespace stay two accounts instead of silently sharing one credential slot), no merging of rules per account, no dedupe of the `models` argument, no `describe`-style helpers. The hash choice (64-bit FNV-1a, BigInt, 12 hex chars) is the smallest thing that satisfies the stated collision requirement without a dependency.
- **Testing.** Every assertion is on real behavior of the real module; no mocks, no spies, no fake timers. The suite covers all five functions, including the three invariant-bearing ones the brief's four tests do not isolate (partial strip, `pinned` preservation, purity). Test 6 exists specifically so the "ref is a legal credential reference name" claim in the brief is machine-checked rather than asserted in prose.
- **Red/green honesty.** RED ran and failed for the stated reason before any implementation existed; the implementation was written after the tests, from the tests, and I did not keep any prior draft.

## Issues or concerns

1. **Always-appended hash suffix (design consequence, no action taken).** The brief asks for a hash suffix "to deduplicate", but `accountRef` is pure and has no registry, so it cannot know whether a collision exists; it therefore appends the suffix unconditionally, and even `accountRef(v, "Team A")` carries 12 hex chars. This is what guarantees two labels with the same escaped base get different refs. If a downstream task (10/13) wants prettier slot names, it must not shorten this — the suffix is the collision guard.
2. **48-bit suffix.** Collision probability for realistic account counts per vendor is negligible, but it is not zero and not cryptographic. Consequence if it ever mattered: two accounts would share one credential slot. Judged acceptable (an account book per user is a handful of rows); a longer suffix is a one-constant change if a reviewer wants more margin.
3. **Refs move with the label — for callers, never for stored identity.** `accountRef` is a pure function of the label, so the ref derived from a label changes if the label changes. This module never re-derives a ref for an existing account, so the invariant holds; but Task 10/13's account port must generate the ref **once at add time** and afterwards key everything (order, rules, pinned, credentials) off the stored ref, renaming only the `label`. If a port re-derived refs on every rename, order/rules/credential slots would silently detach. Flagging because it is the one way this module's contract can be misused.
4. **`assignModelRule` does not merge per-account rules.** Re-assigning a second model to an account that already has a rule leaves two rules for that account (strip-then-append, consistent with the brief's own test where `acc-a`'s rule disappears and `acc-b`'s is appended). Nothing in the brief or the spec requires one rule per account, and Task 5's `pick` looks up by model (first matching rule wins), so this is safe. Consumer contract recorded in the JSDoc: look up **by model**, never by account. If a later task wants one rule per account, that is a behavior change with its own test, not a silent edit here.
5. **`reorder` with duplicate refs.** Only the first occurrence moves; any later duplicate is left in place. `dedupeByRef` is the function that removes duplicates, so this can only be reached with an already-invalid order list. Documented behavior, not tested (no requirement, and pinning it in a test would freeze semantics nobody asked for).

No blockers, no needs-context. Branch state at report time: `d212702` on `work`, working tree clean. `git commit --amend` was not used at any point.
