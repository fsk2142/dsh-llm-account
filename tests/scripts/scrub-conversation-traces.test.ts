import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/scrub-conversation-traces.mjs", import.meta.url));
const tempDirs: string[] = [];

function fixture(files: Readonly<Record<string, string>>): string {
  const dir = mkdtempSync(join(tmpdir(), "dsh-scrub-traces-"));
  tempDirs.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text, "utf8");
  return dir;
}

function apply(dir: string): string {
  return execFileSync(process.execPath, [SCRIPT, "--apply", "--dir", dir], { encoding: "utf8", cwd: dir });
}

function dryRun(dir: string): string {
  return execFileSync(process.execPath, [SCRIPT, "--dir", dir], { encoding: "utf8", cwd: dir });
}

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("scrub-conversation-traces CLI", () => {
  it.each([
    ["// 行为（2026-11-03 用户要求：必须保留技术说明）。\n", "// 行为（必须保留技术说明）。\n"],
    ["// 行为（2026-11-04 外部审查 U06；用户要求两条线都支持）。\n", "// 行为（外部审查 U06；两条线都支持）。\n"],
    ["// 行为（2026-11-03 用户要求）。\n", "// 行为。\n"],
  ])("只删括号里的对话归属，保留技术内容：%s", (before, after) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it.each([
    ["// 行为（2026-11-23 用户需求）。\n", "// 行为。\n"],
    ["// 行为（2026-10-30 按用户要求改）。\n", "// 行为。\n"],
    ["// 为什么需要它（2026-10-21 用户在新设备报障）：「不是版本号」。\n", "// 为什么需要它（在新设备报障）：「不是版本号」。\n"],
    ["// 为什么存在（2026-10-18 用户提问：「每次都要重取吗？」）。\n", "// 为什么存在（问题：「每次都要重取吗？」）。\n"],
    ["// 2026-10-20 用户去掉了两个开关。\n", "// 去掉了两个开关。\n"],
  ])("归属短语单独出现或带普通动作时不得留下病句：%s", (before, after) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it.each([
    ["// 用户报障原话是「模型不能发送图片」。\n", "// 实际现象是「模型不能发送图片」。\n"],
    ["// 为什么必须核对（2026-10-20 用户提出的「多账号」）。\n", "// 为什么必须核对（「多账号」）。\n"],
    ["// 为什么必须有（2026-10-20 用户提的「多账号」）。\n", "// 为什么必须有（「多账号」）。\n"],
    ["// 失败明细（2026-10-20 用户选的 1 + 2）。\n", "// 失败明细（选定 1 + 2）。\n"],
    ["// 用户诉求：「不要拒绝表」。\n", "// 需求：「不要拒绝表」。\n"],
  ])("归属短语与普通技术短语要区分：%s", (before, after) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it("普通技术短语“低于用户要求”不得被当成对话痕迹", () => {
    const dir = fixture({ "sample.ts": "// 降档会让思考量低于用户要求。\n" });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe("// 降档会让思考量低于用户要求。\n");
  });

  it("用户报障原话映射为实际现象，不残留“原话”拼接", () => {
    const dir = fixture({ "sample.ts": "// 用户报障原话：「模型不能发送图片」。\n" });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe("// 实际现象：「模型不能发送图片」。\n");
  });

  it("行内代码、围栏代码与字符串字面量不得被清洗", () => {
    const dir = fixture({
      "sample.ts": "// 示例 `用户要求：「原话」` 保留；用户要求：改写。\nconst text = \"用户要求：不要改\";\n",
      "sample.md": "# 用户要求：正文标题\n\n```ts\n# 用户要求：代码示例\n```\n",
    });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe("// 示例 `用户要求：「原话」` 保留；需求：改写。\nconst text = \"用户要求：不要改\";\n");
    expect(read(dir, "sample.md")).toBe("# 需求：正文标题\n\n```ts\n# 用户要求：代码示例\n```\n");
  });

  it.each([
    ["// 用户需求：保留技术说明。\n", "// 需求：保留技术说明。\n"],
    ["// 用户提问：为什么需要它？\n", "// 问题：为什么需要它？\n"],
    ["// 按用户要求改。\n", "// 按需求改。\n"],
  ])("没有日期时也要命中并自然改写：%s", (before, after) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it("多行模板字符串、正则与普通字符串内部保持原样", () => {
    const before = [
      "const text = `",
      "// 用户要求：不要改",
      "`;",
      "const pattern = /\\/\\/ 用户要求：不要改/;",
      "const plain = \"用户要求：不要改\";",
      "// 用户要求：要改",
      "",
    ].join("\n");
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(before.replace("// 用户要求：要改", "// 需求：要改"));
  });

  it("CRLF Markdown 的未闭合围栏一直保护到 EOF", () => {
    const before = "```powershell\r\n# 用户要求：代码\r\n";
    const dir = fixture({ "sample.md": before });

    apply(dir);

    expect(read(dir, "sample.md")).toBe(before);
  });

  it("Markdown 围栏关闭行必须只有空白，非法闭合不能提前放行", () => {
    const dir = fixture({
      "sample.md": "```ts\n```not-a-close\n# 用户要求：代码示例\n```\n\n用户要求：正文改写。\n",
    });

    apply(dir);

    expect(read(dir, "sample.md")).toBe("```ts\n```not-a-close\n# 用户要求：代码示例\n```\n\n需求：正文改写。\n");
  });

  it.each([
    ["// 用户提出的「多账号」。\n", "// 「多账号」。\n"],
    ["// 用户提的「多账号」。\n", "// 「多账号」。\n"],
  ])("无日期归属词也要命中：%s", (before, after) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it("混合嵌套的纯归属括号不得留下空括号", () => {
    const dir = fixture({ "sample.ts": "// 行为（(用户要求)）。\n" });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe("// 行为。\n");
  });

  it("注释里的函数调用括号不得被当成空括号删除", () => {
    const before = "// snapshot() 的顺序；只有 cancel() 能继续。\n";
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(before);
  });

  it("普通跨行括号没有对话归属时保持原格式", () => {
    const before = "/**\n * 行为（每个窗口一小块，\n * 标签与读数一行）。\n */\n";
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(before);
  });

  it("跨行与嵌套括号只删归属，保留技术内容", () => {
    const before = "/**\n * 行为（2026-11-03\n * 用户要求：必须保留（含嵌套）说明）。\n */\n";
    const after = "/**\n * 行为（必须保留（含嵌套）说明）。\n */\n";
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(after);
  });

  it.each([
    "// 自动汇总多用户需求。\n",
    "// 记录用户报障。\n",
    "// 保存用户原话。\n",
  ])("普通技术短语不得被全局替换：%s", (before) => {
    const dir = fixture({ "sample.ts": before });

    apply(dir);

    expect(read(dir, "sample.ts")).toBe(before);
  });

  it("默认 dry-run 不写文件，第二次 apply 字节不变", () => {
    const dir = fixture({ "sample.ts": "// 用户要求：改写。\n" });
    const before = read(dir, "sample.ts");

    expect(dryRun(dir)).toContain("这是 dry-run");
    expect(read(dir, "sample.ts")).toBe(before);
    apply(dir);
    const once = read(dir, "sample.ts");
    apply(dir);
    expect(read(dir, "sample.ts")).toBe(once);
  });

  it("导入脚本不执行 main", () => {
    const dir = fixture({ "sample.ts": "// 用户要求：不要改。\n" });
    execFileSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(SCRIPT).href)})`], {
      encoding: "utf8",
      cwd: dir,
    });
    expect(read(dir, "sample.ts")).toBe("// 用户要求：不要改。\n");
  });

  it("显式不存在的目录必须非零退出", () => {
    const result = spawnSync(process.execPath, [SCRIPT, "--apply", "--dir", ".review-nonexistent"], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(".review-nonexistent");
  });

  it("Markdown 普通正文也按同一规则清洗", () => {
    const dir = fixture({ "sample.md": "用户要求：保留这段技术说明。\n" });

    apply(dir);

    expect(read(dir, "sample.md")).toBe("需求：保留这段技术说明。\n");
  });
});
