/** README 的当前 UI 操作契约：文档必须指向用户现在真正能看到的入口。 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const readme = readFileSync(join(root, "README.md"), "utf8");

/** 取一个三级标题下的正文；标题不存在时返回空串，让断言报告缺文档而不是抛异常。 */
function section(title: string): string {
  const marker = `### ${title}\n`;
  const start = readme.indexOf(marker);
  if (start < 0) return "";
  const body = readme.slice(start + marker.length);
  const end = body.indexOf("\n### ");
  return end < 0 ? body : body.slice(0, end);
}

describe("README 与当前账户面板一致", () => {
  it("添加账号只指向网页登录", () => {
    const add = section("添加账号");
    expect(add).toContain("网页登录");
    expect(add).not.toMatch(/填 API key|API Key 或网页登录/u);
    expect(add).not.toMatch(/^\s*(?!.*不再提供).*使用 API Key/mu);
  });

  it("手动切号指向账号行的「使用」按钮，不再指向旧菜单", () => {
    const switching = section("切换账号");
    expect(switching).toMatch(/账号行/u);
    expect(switching).toContain("「使用」");
    expect(switching).not.toMatch(/全局切换面板|`⋯`/u);
  });

  it("导出入口指向账户面板头部", () => {
    const exporting = section("导出用量");
    expect(exporting).toContain("账户面板头部");
    expect(exporting).toContain("导出 CSV");
    expect(exporting).not.toContain("设置页 →「用量」");
  });

  it("自动继续覆盖请求失败、max-tokens 与 PROVIDER_STREAM_TRUNCATED，并说明默认关闭与次数限制", () => {
    const autoContinue = section("自动继续");
    expect(autoContinue).toContain("autoContinue");
    expect(autoContinue).toContain("max-tokens");
    expect(autoContinue).toContain("PROVIDER_STREAM_TRUNCATED");
    expect(autoContinue).toMatch(/默认关闭/u);
    expect(autoContinue).toMatch(/次数|最多/u);
  });

  it("删除截断续写不可用的旧说法，改为宿主缺接缝时安全降级", () => {
    expect(readme).not.toContain("当前不可用");
    expect(readme).not.toContain("DSH 目前没有暴露");
    expect(readme).not.toContain("暂不支持");
    const autoContinue = section("自动继续");
    expect(autoContinue).toMatch(/宿主/u);
    expect(autoContinue).toMatch(/接缝/u);
    expect(autoContinue).toMatch(/降级/u);
  });
});
