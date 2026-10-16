"""变异检验：对指定测试文件跑一批精确反向编辑的变异，每个都必须让测试变红。

安全约束（吸取教训）：
- 每个变异**独立**从磁盘原文出发；
- 还原写回**内存里那份原文**，绝不读被自己截断的文件（`open(path,"w")` 会先把文件清空）；
- 跑完断言磁盘内容 == 原文，否则立刻报错并打印路径。
"""
import subprocess
import sys

MUTATIONS = [
    ("侧边栏卡片关闭时不门控渲染", "src/client/seams.ts",
     '    if (vendor === undefined) return null as unknown as ReactElement;\n    return SidebarCard({ t, status, onOpen: () => options.onOpen() });',
     '    return SidebarCard({ t, status: status ?? { vendor: "x", accounts: [], failures: [] } as never, onOpen: () => options.onOpen() });'),
    ("关闭开关后不停轮询（去掉提前 return）", "src/client/seams.ts",
     "      if (vendor === undefined) {\n        setStatus(undefined);\n        return;\n      }",
     "      if (vendor === undefined) {\n        setStatus(undefined);\n      }"),
    ("开关存储不再通知订阅者（卡片不跟随）", "src/client/seams.ts",
     "  if (vendor === sidebarVendorValue) return;\n  sidebarVendorValue = vendor;\n  for (const listener of [...sidebarVendorListeners]) listener(vendor);",
     "  if (vendor === sidebarVendorValue) return;\n  sidebarVendorValue = vendor;"),
    ("页面卸载时 dispose 共享远程面", "src/client/seams.ts",
     "        alive = false;\n        off();\n        offUsage();",
     "        alive = false;\n        off();\n        offUsage();\n        ensureUsageRemote(ctx).dispose();"),
    ("保存失败不记错误（静默失败）", "src/client/seams.ts",
     "          setState((current) => noteSaveResult(current, ns, error));\n          void describeVendorSnapshots(ctx, entries).then((snapshots) => adopt(snapshots));\n        });\n      },\n",
     "          if (error !== undefined) return;\n        });\n      },\n"),
    ("保存不重读基线（乐观修订号）", "src/client/seams.ts",
     "          setState((current) => noteSaveResult(current, ns, error));\n          void describeVendorSnapshots(ctx, entries).then((snapshots) => adopt(snapshots));\n        });\n      },\n",
     "          setState((current) => noteSaveResult(current, ns, error));\n        });\n      },\n"),
    ("onSave 写命名空间而不是行名", "src/client/seams.ts",
     "        void saveSettings(ctx, snapshot?.row ?? ns, fields, snapshot?.revision ?? 0).then((error) => {",
     "        void saveSettings(ctx, ns, fields, snapshot?.revision ?? 0).then((error) => {"),
    ("账户操作不派发", "src/client/seams.ts",
     "                  const pending = state.action === undefined ? undefined : dispatchAccountAction(usage, activeVendor, state.action);",
     "                  const pending = state.action === undefined ? undefined : undefined;"),
    ("添加表单不再自动打开 add 操作", "src/client/account-card.ts",
     '    if (!adding) props.onOpenAction({ kind: "add" });\n    props.onActionField(field, value);',
     "    props.onActionField(field, value);"),
    ("设置镜像不再订阅 settings/document-updated", "src/client/seams.ts",
     '    remote.$on("settings/document-updated", () => {',
     '    if (false) remote.$on("settings/document-updated", () => {'),
]

TEST = sys.argv[1] if len(sys.argv) > 1 else "tests/client/randomized-simulation.test.ts"


def run(cmd: str) -> str:
    return subprocess.run(cmd, shell=True, capture_output=True, text=True).stdout


def write(path: str, content: str) -> None:
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(content)


survivors = []
for name, path, old, new in MUTATIONS:
    with open(path, encoding="utf-8", newline="") as handle:
        original = handle.read()
    # 工作区可能是 CRLF（Windows checkout），锚点按 LF 写 —— 先探测再统一。
    eol = "\r\n" if "\r\n" in original else "\n"
    old_eol = old.replace("\n", eol)
    new_eol = new.replace("\n", eol)
    if original.count(old_eol) != 1:
        print(f"SKIP (anchor x{original.count(old_eol)}): {name}")
        survivors.append(name)
        continue
    write(path, original.replace(old_eol, new_eol))
    out = run(f"pnpm vitest run {TEST} 2>&1 | tail -4")
    red = "failed" in out or "FAIL" in out
    write(path, original)  # 还原用的是内存里那份原文
    with open(path, encoding="utf-8", newline="") as handle:
        if handle.read() != original:
            print(f"RESTORE FAILED for {path}")
            sys.exit(2)
    print(f"{'RED ' if red else 'GREEN!!'} | {name}")
    if not red:
        survivors.append(name)

print()
print("SUMMARY:", "ALL KILLED" if not survivors else f"SURVIVORS({len(survivors)}): {survivors}")