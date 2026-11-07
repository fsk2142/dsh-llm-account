/**
 * DSML 工具调用文本解析（2026-11-07 真机故障）。
 *
 * 用例里的样本**逐字取自真机会话日志**（session-c0aacab8 的 seq 88192），
 * 不是自己编的格式 —— 这类解析器最容易犯的错就是「按想象的正则写，真机一个都对不上」。
 */
import { describe, expect, it } from "vitest";

import { parseDsmlCalls } from "../../src/vendors/opencode/dsml";

/** 真机样本：一次 `terminal_send` 调用。 */
const REAL = [
  "但 Warnings 从 12 变成 156，需要确认这些告警是否影响功能。",
  "",
  "<｜DSML｜ calls>",
  "<｜DSML｜ invoke name=\"terminal_send\">",
  "<｜DSML｜ parameter name=\"sessionId\" string=\"true\">pty-9</｜DSML｜ parameter>",
  "<｜DSML｜ parameter name=\"text\" string=\"true\">cd C:\\Work\\fpga_module; Select-String -Path _r7_top.log -Pattern '\\*\\* Warning' | ForEach-Object { $m=[regex]::Match($_.Line,'\\((vsim|vopt|vlog)[- ](\\d+)\\)') }</｜DSML｜ parameter>",
  "</｜DSML｜ invoke>",
  "</｜DSML｜ calls>",
].join("\n");

describe("parseDsmlCalls", () => {
  it("**真机样本能解析出工具名与参数**（2026-11-07 的 4 次中断就是它没被解析）", () => {
    const calls = parseDsmlCalls(REAL);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe("terminal_send");
    const args = JSON.parse(calls[0]!.arguments) as Record<string, unknown>;
    expect(args.sessionId, "string=\"true\" 必须保持字符串（pty-9 不能变成数字）").toBe("pty-9");
    expect(String(args.text)).toContain("Select-String");
    expect(String(args.text), "参数里可以有括号、反斜杠、花括号").toContain("(vsim|vopt|vlog)");
  });

  it("没有 DSML 标记时返回空数组（绝不把普通正文当工具调用）", () => {
    expect(parseDsmlCalls("普通回复，里面有 <tag> 和 </tag>，还有 a > b")).toEqual([]);
    expect(parseDsmlCalls("")).toEqual([]);
  });

  it("有 calls 块但里面没有 invoke → 空数组（宁可当空响应重试，也不猜工具名）", () => {
    expect(parseDsmlCalls("<｜DSML｜ calls>\n没有调用\n</｜DSML｜ calls>")).toEqual([]);
  });

  it("多个 invoke 按顺序全部解析", () => {
    const two = [
      '<｜DSML｜ calls>',
      '<｜DSML｜ invoke name="a">',
      '<｜DSML｜ parameter name="x" string="true">1</｜DSML｜ parameter>',
      "</｜DSML｜ invoke>",
      '<｜DSML｜ invoke name="b">',
      '<｜DSML｜ parameter name="y" string="true">2</｜DSML｜ parameter>',
      "</｜DSML｜ invoke>",
      "</｜DSML｜ calls>",
    ].join("\n");
    expect(parseDsmlCalls(two).map((call) => call.name)).toEqual(["a", "b"]);
  });

  it("半角竖线的变体也认（模型偶尔不写全角）", () => {
    const half = [
      '<|DSML| calls>',
      '<|DSML| invoke name="run">',
      '<|DSML| parameter name="cmd" string="true">ls</|DSML| parameter>',
      "</|DSML| invoke>",
      "</|DSML| calls>",
    ].join("\n");
    const calls = parseDsmlCalls(half);
    expect(calls.map((call) => call.name)).toEqual(["run"]);
    expect(JSON.parse(calls[0]!.arguments)).toEqual({ cmd: "ls" });
  });

  it("没声明 string 的数值参数还原成数字（工具收到的类型不变）", () => {
    const numeric = [
      "<｜DSML｜ calls>",
      '<｜DSML｜ invoke name="job_output">',
      '<｜DSML｜ parameter name="timeout_ms">5000</｜DSML｜ parameter>',
      "</｜DSML｜ invoke>",
      "</｜DSML｜ calls>",
    ].join("\n");
    expect(JSON.parse(parseDsmlCalls(numeric)[0]!.arguments)).toEqual({ timeout_ms: 5000 });
  });

  it("重复调用两次结果一致（正则带 /g，必须每次重置 lastIndex）", () => {
    expect(parseDsmlCalls(REAL)).toEqual(parseDsmlCalls(REAL));
  });
});
