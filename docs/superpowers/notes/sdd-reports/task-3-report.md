# Task 3 Report — 凭据解析优先级

**Status:** DONE
**Commit:** `047c885` — `feat(core): credential resolution precedence`
**Branch:** `work` (parent `af90093`)
**Files:** `src/core/credentials.ts` (new), `tests/core/credentials.test.ts` (new) — nothing else touched.

## What I implemented

A pure-function module for the fixed credential-source precedence, no I/O, no classes, no imports at all:

- `type CredentialSource = "literal" | "stored" | "environment" | "auth-file"` — exactly the four strings the brief's tests use.
- `interface CredentialSources` — optional `literal`, `stored`, `environment`, `authFile` (all `string | undefined`). The module never reads these sources; Task 9–13's adapters collect them and inject them.
- `normalizeKey(raw: unknown): string | undefined` — non-string (including `null`) → `undefined`; trims; empty/whitespace-only → `undefined`.
- `pickApiKey(sources: CredentialSources): { key?: string; source?: CredentialSource }` — walks `literal → stored → environment → authFile` as a data table and returns the first entry whose raw value survives `normalizeKey`; otherwise `{ key: undefined, source: undefined }`.

This lands Review Focus #3. Per the controller note, `CredentialPort` is **not** redefined here (it stays in `src/core/adapter.ts`); the module needs no host types, so it has zero imports. `export type`/`import type` discipline is moot (no type imports); the type union is exported with `export type`.

## What I tested and results

Four tests in `tests/core/credentials.test.ts`:

1. Precedence: literal > stored > environment > auth-file (all four levels asserted).
2. Empty string / whitespace-only counts as unconfigured (`stored: "   "` falls through to `environment`; `{ stored: "" }` → `{ key: undefined, source: undefined }`).
3. Surrounding whitespace is trimmed (`{ stored: " key " }` → `"key"`).
4. `normalizeKey` accepts only a non-empty trimmed string — covers the `unknown` narrowing (`undefined`, `null`, `42`, `{key:"key"}` → `undefined`).

Test 4 is a deliberate small extension beyond the brief's three tests: `normalizeKey` is on the Produces list with an `unknown` parameter, and its non-string branch is otherwise unexercised. No other tests were added.

Final full-suite verification (before commit):

```
$ pnpm typecheck && pnpm test
$ tsc --noEmit          # clean, no diagnostics
 ✓ tests/smoke.test.ts (1 test) 2ms
 ✓ tests/core/adapter.test.ts (2 tests) 2ms
 ✓ tests/core/credentials.test.ts (4 tests) 3ms
 Test Files  3 passed (3)
      Tests  7 passed (7)
```

No other test file in the run failed. Output pristine (no warnings, no stderr noise beyond the `$ tsc --noEmit` script echo).

## TDD evidence

**RED** — `pnpm vitest run tests/core/credentials.test.ts` (test written first, module not yet created):

```
 ❯ tests/core/credentials.test.ts (0 test)
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯
 FAIL  tests/core/credentials.test.ts [ tests/core/credentials.test.ts ]
Error: Cannot find module '../../src/core/credentials' imported from C:/Work/dsh-llm-account/tests/core/credentials.test.ts
 ❯ tests/core/credentials.test.ts:3:1
     3| import { normalizeKey, pickApiKey } from "../../src/core/credentials";
      | ^
 Test Files  1 failed (1)
      Tests  no tests
[exit code: 1]
```

Why expected: the implementation module does not exist yet, so nothing named `pickApiKey`/`normalizeKey` exists to be called. The brief predicted the message ``pickApiKey` 未定义`; the observed message is the module-resolution form of the same root cause — the whole file is new, so resolution fails before the identifier lookup. It is a real failure of the feature under test, not a typo: the import path is the path I then created, and it went green unchanged.

**GREEN** — `pnpm vitest run tests/core/credentials.test.ts` after implementing:

```
 ✓ tests/core/credentials.test.ts (4 tests) 3ms
 Test Files  1 passed (1)
      Tests  4 passed (4)
```

Then the full `pnpm typecheck && pnpm test` (above) before committing.

## Files changed

| File | Change |
| --- | --- |
| `src/core/credentials.ts` | new, 57 lines |
| `tests/core/credentials.test.ts` | new, 29 lines |

`git show --stat`: 2 files changed, 86 insertions(+), no deletions, no other paths.

## Self-review findings

- **Completeness:** all four names on the Produces list are exported: `pickApiKey`, `CredentialSources`, `CredentialSource`, `normalizeKey`. `CredentialSource`'s members match the test strings exactly. No `CredentialPort` redefinition (verified: the file contains no reference to it).
- **Constraints:** `Select-String` over `src/core/credentials.ts` for `commandcode|opencode|any\b` (case-insensitive) returns nothing — no vendor words, no `any`, no host imports. Return type is written inline exactly as the brief specifies, so no extra exported type name crept in.
- **Quality:** names state what they do; precedence lives in one ordered table rather than four copy-pasted branches, so reordering is a one-line change and can't silently diverge between branches.
- **Discipline (YAGNI):** nothing beyond the brief — no caching, no env reading, no logging, no result-object type, no helper module.
- **Testing:** tests assert observable behavior of the real function (no mocks, no spies, no implementation reach-ins); each of the brief's assertions is present verbatim.
- **Working tree:** clean after commit; commit is a plain new commit, no `--amend` used.

## Issues or concerns

1. **RED message wording** (cosmetic, described above): observed `Cannot find module …` rather than ``pickApiKey` 未定义`. Same root cause and the test was never edited between RED and GREEN, but flagging it so the controller sees the raw evidence rather than a paraphrase.
2. **`CRLF` notice on `git add`:** git reported `LF will be replaced by CRLF` for both new files — that is this repo's `core.autocrlf` setting applying to every new file, not a content problem. The committed blobs are LF.
3. **Ambiguity I resolved, not a blocker:** the brief's Produces signature returns an anonymous object type. I kept it anonymous (no `PickedApiKey` export) to avoid adding a name outside the brief. If a later task wants to narrow on that result type, it can add the alias then.
