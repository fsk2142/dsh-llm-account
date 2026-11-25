import { describe, expect, it } from "vitest";

import { redactDiagnostic } from "../../src/core/diagnostic-text";

describe("redactDiagnostic", () => {
  it("脱敏邮箱、账号 ref、密钥与 Bearer token，保留病因", () => {
    const input = "EACCES user@example.com DSH_LLM_ACCOUNT_OPENDESIGN_user_example_com_ab12cd sk-FAKEKEY123456789 vela_ctrl_FAKE123456 Authorization: Bearer abc.def";
    const output = redactDiagnostic(input);
    expect(output).toContain("EACCES");
    expect(output).not.toContain("user@example.com");
    expect(output).not.toContain("DSH_LLM_ACCOUNT_OPENDESIGN_");
    expect(output).not.toContain("sk-FAKEKEY");
    expect(output).not.toContain("vela_ctrl_");
    expect(output).not.toContain("abc.def");
  });

  it("脱敏本机用户路径但保留文件名与错误码", () => {
    const output = redactDiagnostic(String.raw`spawn EACCES C:\Users\Alice\AppData\vela.exe; /home/bob/bin/vela denied`);
    expect(output).toContain("EACCES");
    expect(output).toContain("vela.exe");
    expect(output).not.toContain("Alice");
    expect(output).not.toContain("/home/bob");
  });

  it("脱敏激活 URL 的敏感查询值", () => {
    const output = redactDiagnostic("https://open-design.ai/activate?deviceId=dev-123&email=user%40example.com&code=ABCD");
    expect(output).toContain("https://open-design.ai/activate");
    expect(output).not.toContain("dev-123");
    expect(output).not.toContain("user%40example.com");
    expect(output).not.toContain("ABCD");
  });

  it("普通技术文案原样保留", () => {
    expect(redactDiagnostic("cannot reach licensing server (HTTP 503)")).toBe("cannot reach licensing server (HTTP 503)");
  });
});
