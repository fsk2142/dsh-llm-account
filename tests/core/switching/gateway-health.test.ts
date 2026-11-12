/**
 * 网关健康表（2026-11-12 审查 A07）。
 *
 * ## 被钉住的取舍
 *
 * 三家适配器原来都写 `sameGatewayOnly: failureKind === "network"` ——
 * 「一个 network 错误码 ⇒ 全网不可达」。那个推论有两个反例：
 *
 * | 真实情况 | 旧行为 | 应该 |
 * | --- | --- | --- |
 * | 整台机器断网 | 同网关内换，白试 | 不跨网关（旧行为对） |
 * | **只有 A 家域名挂了 / 被 VPN 分流拦住** | 同网关内换，A 家本来就不可达 | **跨到 B 家救援** |
 *
 * 第二种正是用户实际场景（「开 VPN 时某些网关连不上」）。
 *
 * 现在改成按网关判断：network 失败时只记**本家**，换模型时只排除
 * 「最近网络失败过的那几家」。
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
  NETWORK_DOWN_WINDOW_MS,
  isNetworkDown,
  noteNetworkFailure,
  recentlyNetworkDown,
  resetGatewayHealth,
} from "../../../src/core/switching/gateway-health";

beforeEach(() => {
  resetGatewayHealth();
});

describe("网关健康表：按网关而不是按错误码", () => {
  it("**只记失败的那一家**（这是能救援别家的前提）", () => {
    noteNetworkFailure("opendesign", 1_000);
    expect(recentlyNetworkDown(1_000)).toEqual(["opendesign"]);
    expect(isNetworkDown("commandcode", 1_000), "没失败过的那家不该被牵连").toBe(false);
  });

  it("多家失败后一起被列出（整网断的情形）", () => {
    noteNetworkFailure("opendesign", 1_000);
    noteNetworkFailure("commandcode", 1_500);
    expect([...recentlyNetworkDown(1_500)].sort()).toEqual(["commandcode", "opendesign"]);
  });

  it("**超过窗口后自动失效**（网络恢复了就该重新可用）", () => {
    noteNetworkFailure("opendesign", 1_000);
    expect(recentlyNetworkDown(1_000 + NETWORK_DOWN_WINDOW_MS - 1)).toEqual(["opendesign"]);
    expect(recentlyNetworkDown(1_000 + NETWORK_DOWN_WINDOW_MS + 1), "窗口外不该再被排除").toEqual([]);
  });

  it("同一家再次失败会刷新时刻（不会因为老记录过期而误放行）", () => {
    noteNetworkFailure("opendesign", 1_000);
    noteNetworkFailure("opendesign", 40_000);
    // 距第一次已 59s（超出 60s 窗口边界差 1s），但距第二次只有 20s。
    expect(recentlyNetworkDown(60_000)).toEqual(["opendesign"]);
  });

  it("空 provider 被忽略（形状不可信，不能写进表里）", () => {
    noteNetworkFailure("", 1_000);
    expect(recentlyNetworkDown(1_000)).toEqual([]);
  });
});
