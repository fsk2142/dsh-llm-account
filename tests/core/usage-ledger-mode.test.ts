/**
 * 台账文件权限（2026-11-12 审查 A10）。
 *
 * ## 被钉住的缺陷
 *
 * 台账里有 vendor、账号 ref、模型、token 数与时间戳 —— 不含 prompt、不含密钥，
 * 但它仍然是**用量行为画像**。旧代码不设 `mode`，权限完全取决于进程 umask：
 * 在 umask 022 的机器上目录 0755（同机其他用户可读）、文件 0644。
 *
 * 现在目录建 0700、日文件建 0600（`mode` 只在创建时生效）。
 *
 * ## 为什么这条用例只在 POSIX 上跑
 *
 * Windows 没有 POSIX 权限位 —— `mode` 被 Node 忽略，测出来的永远是 0666/0777 那套。
 * 在那上面断言 0600 会**恒假**，那是环境差异不是缺陷。所以按平台跳过：
 * 该守的性质（POSIX 上只有属主可读）由这条用例守；
 * Windows 一侧的隔离是系统 ACL 的事，本插件不承诺也不该假装承诺。
 */
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createUsageLedger } from "../../src/core/usage/ledger";

/** Windows 上没有 POSIX 权限位，这组断言无意义。 */
const posix = process.platform !== "win32";

describe.skipIf(!posix)("台账权限：只有属主可读写（A10）", () => {
  it("**新建目录是 0700**（同机其他用户读不到这份画像）", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-usage-mode-"));
    try {
      const directory = join(root, "usage");
      const ledger = createUsageLedger(directory);
      await ledger.record({ vendor: "opendesign", account: "a", outcome: "success" });
      const info = await stat(directory);
      // 只看低 9 位（权限位）；高位是文件类型。
      expect(info.mode & 0o777, `mode=${(info.mode & 0o777).toString(8)}`).toBe(0o700);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("**新建日文件是 0600**（其他用户读不到具体请求）", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-usage-mode-"));
    try {
      const directory = join(root, "usage");
      const ledger = createUsageLedger(directory);
      await ledger.record({ vendor: "opendesign", account: "a", outcome: "success" });
      const names = await readdir(directory);
      expect(names.length, "应该写出一个日文件").toBeGreaterThan(0);
      const info = await stat(join(directory, names[0]!));
      expect(info.mode & 0o777, `mode=${(info.mode & 0o777).toString(8)}`).toBe(0o600);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("台账权限：Windows 上不做 POSIX 断言（避免恒假用例）", () => {
  it.skipIf(posix)("写盘本身仍然正常（只有权限位不可测）", async () => {
    const root = await mkdtemp(join(tmpdir(), "dsh-usage-mode-"));
    try {
      const directory = join(root, "usage");
      const ledger = createUsageLedger(directory);
      await ledger.record({ vendor: "opendesign", account: "a", outcome: "success" });
      expect((await readdir(directory)).length).toBeGreaterThan(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
