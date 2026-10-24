# DSH 版本声明的统一做法（2026-10-24 定案）

三个插件（`dsh-llm-account`、`dsh-safe-delete`、`dsh-fpga-workbench`）统一按本文的
写法声明兼容性。**核对过宿主源码，不是推断**。

---

## 一、结论：只用一条

```json
{
  "engines": {
    "node": ">=22.19.0",
    "dsh": ">=0.2.0-rc.2"
  },
  "peerDependencies": {
    "@deepseek-ai/dsh-llm": ">=0.2.0-rc.2",
    "@deepseek-ai/dsh-settings": ">=0.2.0-rc.2",
    "…": ">=0.2.0-rc.2"
  }
}
```

**所有 `@deepseek-ai/dsh*` 包都写 `>=0.2.0-rc.2`，不要累加、不要枚举。**

---

## 二、为什么这样写就够（宿主源码依据）

`@deepseek-ai/dsh-app-boot` 的 `plugin-compatibility.js`：

```js
function satisfies(runtimeVersion, range) {
  return range.trim() !== "" && semver.satisfies(runtimeVersion, range, { includePrerelease: true });
}
```

**关键是 `includePrerelease: true`。**

没有这个选项时，semver 会让 `>=0.2.0-rc.2` **匹配不到** `0.2.1-rc.3`（预发布规则：
范围内出现过的 `[major, minor, patch]` 元组才放行 prerelease）。带上它之后，一切
`0.2.0-rc.2` 及其后的版本（含各 minor 的 rc / alpha）都匹配。

实测（`semver.satisfies(v, ">=0.2.0-rc.2", { includePrerelease: true })`）：

| 版本 | 结果 |
| --- | --- |
| `0.1.7-rc.2` | ✗ 拒绝 |
| `0.2.0-rc.1` | ✗ 拒绝 |
| `0.2.0-rc.2` | ✓ 支持 |
| `0.2.1-rc.2` | ✓ 支持 |
| `0.2.1-rc.3` | ✓ 支持 |
| `0.2.2` / `0.3.0` / `1.0.0` | ✓ 支持 |

---

## 三、两个容易踩的坑

### 坑 1：自己测 semver 时会得到相反结论

用默认选项测：

```js
semver.satisfies("0.2.1-rc.3", ">=0.2.0-rc.2")  // false ← 会误导你以为写法错了
semver.satisfies("0.2.1-rc.3", ">=0.2.0-rc.2", { includePrerelease: true })  // true ← 宿主的行为
```

**验证时务必带上 `{ includePrerelease: true }`**，否则会得出「必须累加枚举」的错误结论。

### 坑 2：累加式写法是冗余的

```json
">=0.1.7-rc.2 || >=0.2.0-rc.1 || >=0.2.0-rc.2 || >=0.2.1-rc.2 || >=0.2.1-rc.3"
```

这在 `includePrerelease` 下与 `>=0.1.7-rc.2` 等价（后面的段全被前面的覆盖）。
**不要这么写**：每出一个版本就要追加一段，而且容易漏掉中间某段。

---

## 四、`engines.dsh` 与 `peerDependencies` 的关系

宿主的判定逻辑（源码注释原文）：

> An own `engines.dsh` range decides **alone** and peerDependencies are **ignored**;
> otherwise every `@deepseek-ai/dsh` or `@deepseek-ai/dsh-*` peer must match.

```js
function unmetRequirements(fields, runtimeVersion) {
  const engines = Object.hasOwn(fields, "engines") ? objectOf$1(fields.engines, …) : {};
  if (Object.hasOwn(engines, "dsh")) {
    // ← 有 engines.dsh：只判它，peerDependencies 完全不看
    return satisfies(runtimeVersion, engines.dsh) ? {} : { "engines.dsh": engines.dsh };
  }
  if (!Object.hasOwn(fields, "peerDependencies")) return {};
  // ← 只有没写 engines.dsh 时，才逐个检查 peer
  for (const [name, range] of Object.entries(dependencies)) { … }
}
```

**所以**：

- 写了 `engines.dsh` → 它是唯一的判据，peer 的版本**不影响加载**；
- 写 `>=0.2.0-rc.2` 的 peer 范围，作用只是**消掉 pnpm 的 peer 警告**、让声明本身准确；
- 但不要因此把 peer 写成 `*` —— 那会让「声明支持哪些版本」这件事失去表达力。

---

## 五、第三方库不要跟着改

这些是独立发布的包，与 DSH 的版本号**没有对应关系**：

| 包 | 保持原样 |
| --- | --- |
| `@deepseek-ai/cordis` | `~4.0.4 \|\| ~4.0.5` |
| `@deepseek-ai/schemastery` | `~3.18.4 \|\| ~3.18.5` |
| `react` | `^18.2.0` |

判断标准：**包名是 `@deepseek-ai/dsh` 或以 `@deepseek-ai/dsh-` 开头** → 跟 DSH 版本走；
其余 → 保持独立版本约束。

---

## 六、升级到新 DSH 版本时的检查清单

宿主升到新版本（如 `0.2.2`）时，按这个顺序查：

1. **`engines.dsh` 是否需要动**：若新版本仍 `>=0.2.0-rc.2`，**不用改**；
2. **运行时依赖是否都在**：读新版本的 `app.asar`，确认插件 import 的包都存在；
3. **关键 API 是否变**：`LlmAdapter` / `registerAdapter` / `TypertRemoteService` /
   `registerSearchProvider` 等；
4. **数据形状是否变**：例如 `web_search` 的返回 schema；
5. **跑一遍测试**：`pnpm test` 全绿才算兼容。

**不需要**做的事：不要因为版本号变了就累加 `engines.dsh`，那没有实际作用。

---

## 七、`dshReleases` 字段（可选）

若插件用了 `dsh.compatibility.dshReleases` 记录验证过的版本：

```json
{
  "dsh": {
    "compatibility": {
      "dshReleases": {
        "0.2.0-rc.2": "compatible",
        "0.2.1-rc.2": "compatible",
        "0.2.1-rc.3": "compatible"
      }
    }
  }
}
```

它只是**给人看的验证记录**，不参与宿主判定。**建议与 `engines.dsh` 保持一致**：
`engines.dsh` 若声明 `>=0.2.0-rc.2`，那 `dshReleases` 里就不该出现 `0.1.7-rc.2` ——
否则读者会以为那个老版本还被支持。

若确实要支持更老的版本（如 `dsh-fpga-workbench` 验证过 `0.1.7-rc.2`），那
`engines.dsh` 就该写 `>=0.1.7-rc.2`，而不是累加一串。**两种写法选一个，不要混。**
