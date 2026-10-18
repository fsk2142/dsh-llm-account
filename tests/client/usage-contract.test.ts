/**
 * 远程面契约测试：描述符形状 + 边界校验器 + **边界数据到渲染的整条链**。
 *
 * 为什么这个文件重要：`usage-contract.ts` 的解析器是**主机数据进入客户端的唯一入口**，
 * 而它们刻意只做结构校验（模块注释：「数据由宿主产生，深校验没有额外价值」）。
 * 于是「结构合法但字段是 `null`」的载荷会一路流到渲染路径 —— 今天修掉的
 * `switchNotice` 崩溃（`effective: null` → `null !== undefined` → 读 `.ref` 抛错，
 * 整块侧边栏变空白）正是这一类。结构校验拦不住它，所以第三组用例直接把
 * 「解析 → 渲染」打通来拦。
 *
 * 描述符形状有两个可对照的权威来源（都不是本项目自己说的）：
 * 1. 安装的 `@deepseek-ai/dsh-typert-protocol` 类型定义（`InvocationDescriptor` /
 *    `InvocationParameterDescriptor` / `TypertCodec` / `TypertSchema`）；
 * 2. 本机已装的旧插件产物（`@mars-sea/dsh-commandcode-provider/lib/client.js` 的
 *    `makeRemoteDescriptor` 第 2320-2330 行与 `makeStrictCodec` 第 2308-2314 行）。
 */
import { describe, expect, it } from "vitest";

import {
  USAGE_NAMESPACE,
  USAGE_PACKAGE,
  USAGE_SERVICE_KEY,
  usageDescriptors,
  parseVendorId,
  type UsageInvocationDescriptor,
} from "../../src/client/usage-contract";
import { AccountCard } from "../../src/client/account-card";
import { OpenCodeAccountCard } from "../../src/client/opencode-account-card";
import { SidebarCard } from "../../src/client/sidebar-card";
import { Dashboard } from "../../src/client/dashboard";
import { dictionaryOf } from "../../src/client/copy";
import { elementsOfSim as elementsOf, textsOfSim as textsOf } from "../support/container-sim";
import type { VendorUsageStatus } from "../../src/client/usage-contract";
import type { AccountView } from "../../src/core/adapter";

const t = dictionaryOf("zh");

/** 每个描述符的解析器（`result.create().parse` 就是边界校验函数）。 */
function parserOf(descriptor: UsageInvocationDescriptor): (value: unknown) => unknown {
  return descriptor.result.create().parse;
}

// —— 1. 描述符形状契约 ————————————————————————————

describe("远程面描述符契约", () => {
  const descriptors = usageDescriptors();

  it("字段集与 typert 的 InvocationDescriptor 一致（不缺必需字段）", () => {
    // 必需字段来自 node_modules/@deepseek-ai/dsh-typert-protocol 的 types.d.ts。
    const required = ["id", "service", "namespace", "method", "invocation", "parameters", "result"];
    for (const descriptor of descriptors) {
      for (const field of required) {
        expect(Object.hasOwn(descriptor, field), `${descriptor.method} missing ${field}`).toBe(true);
      }
      expect(descriptor.invocation, descriptor.method).toEqual({ kind: "direct" });
      expect(Array.isArray(descriptor.parameters), descriptor.method).toBe(true);
      // codec 形状 = makeStrictCodec（mode/typeSymbol/create）。
      expect(descriptor.result.mode, descriptor.method).toBe("strict");
      expect(typeof descriptor.result.typeSymbol, descriptor.method).toBe("string");
      expect(typeof descriptor.result.create, descriptor.method).toBe("function");
    }
  });

  it("id / service / namespace 沿用旧插件的同一套惯例", () => {
    // 旧插件：id = `<npm 包名>#<endpoint>`，service 是驼峰 key，namespace 是短名。
    for (const descriptor of descriptors) {
      expect(descriptor.id, descriptor.method).toBe(`${USAGE_PACKAGE}#${USAGE_NAMESPACE}/${descriptor.method}`);
      expect(descriptor.service, descriptor.method).toBe(USAGE_SERVICE_KEY);
      expect(descriptor.namespace, descriptor.method).toBe(USAGE_NAMESPACE);
    }
    // 三个常量本身也对照旧插件的取值形状（包名 = package.json 的 name）。
    expect(USAGE_PACKAGE).toBe("dsh-llm-account");
    expect(USAGE_SERVICE_KEY).toMatch(/^[a-z][a-zA-Z]*$/);
    expect(USAGE_NAMESPACE).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("每个参数都有 name/wire/source/codec 四个字段（typert 的参数契约）", () => {
    for (const descriptor of descriptors) {
      for (const parameter of descriptor.parameters as readonly Record<string, unknown>[]) {
        expect(typeof parameter["name"], descriptor.method).toBe("string");
        expect(parameter["wire"], descriptor.method).toBe(parameter["name"]);
        expect(parameter["source"], descriptor.method).toBe("json");
        const codec = parameter["codec"] as Record<string, unknown>;
        expect(codec["mode"], descriptor.method).toBe("strict");
        expect(typeof codec["typeSymbol"], descriptor.method).toBe("string");
        expect(typeof codec["create"], descriptor.method).toBe("function");
      }
    }
  });

  it("每次调用返回新数组（调用方改不动共享常量）", () => {
    const first = usageDescriptors();
    const second = usageDescriptors();
    expect(first).not.toBe(second);
    first.length = 0;
    expect(usageDescriptors()).toHaveLength(second.length);
  });
});

/**
 * **参数**校验器：真值必须过得去。
 *
 * 这一组是为了钉住一个真实故障：`VENDOR_PARAM` 曾把单参的 `parseVendorId` 直接挂到
 * `(endpoint, value)` 的契约上（少写一个形参在 TypeScript 里是合法的），于是
 * `parameterOf` 把**端点名**当成 vendor 值去比对白名单 —— 每次调用都在网关边界上被拒：
 * `wire field "vendor" failed boundary validation`。表现是「账号数据暂不可用」与「点了
 * 添加账户没反应」，而描述符形状测试、结果解析器测试全都通过（它们都没走这条路径）。
 *
 * 所以这里**必须**走宿主真正走的那条路：`parameter.codec.create().parse(value)`。
 */
describe("参数校验器接受真值", () => {
  /** 每个参数名一个代表值（语义取自 `usage-contract.ts` 里各解析器的契约）。 */
  const GOOD: Record<string, unknown> = {
    vendor: "commandcode",
    ref: "COMMANDCODE_API_KEY",
    input: { label: "work", key: "sk-1" },
    label: "work",
    key: "sk-1",
    toIndex: 0,
    value: true,
    order: ["commandcode:COMMANDCODE_API_KEY"],
    models: ["gpt-6-luna"],
    settings: { strategy: "order", intervalMinutes: 60, atTurnEnd: true, autoSwitch: true },
  };

  const seen = new Set<string>();

  for (const descriptor of usageDescriptors()) {
    for (const raw of descriptor.parameters as readonly Record<string, unknown>[]) {
      const name = String(raw["name"]);
      const codec = raw["codec"] as { create: () => { parse: (value: unknown) => unknown } };
      const parse = codec.create().parse;
      seen.add(name);
      const value = GOOD[name];
      expect(value, `no sample value for parameter "${name}"`).not.toBeUndefined();
      it(`${descriptor.method}(${name}) 接受 ${JSON.stringify(value)}`, () => {
        expect(parse(value)).toEqual(value);
      });
    }
  }

  it("每个参数名都有代表值（新加参数时这条会先失败，逼你补样本）", () => {
    for (const name of seen) expect(Object.hasOwn(GOOD, name), name).toBe(true);
  });

  it("厂商 id 仍然只认白名单里的两个（真值能过 ≠ 白名单放开）", () => {
    expect(parseVendorId("commandcode")).toBe("commandcode");
    expect(parseVendorId("dsh-opencode-go")).toBe("dsh-opencode-go");
    expect(() => parseVendorId("nope")).toThrow();
  });
});

// —— 2. 边界校验器的性质 ————————————————————————————

/** 一批敌意值（解析器必须抛**边界错误**，而不是 TypeError/静默接受）。 */
const HOSTILE: readonly unknown[] = [
  undefined,
  null,
  0,
  -1,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  "",
  " ",
  "quota",
  "COMMANDCODE",
  "opencode",
  [],
  [null],
  [{}],
  {},
  { accounts: "no" },
  { accounts: [] },
  { state: 1 },
  { ref: 1 },
  { label: 1 },
  () => "x",
  Symbol("s"),
  10n,
];

describe("边界校验器的性质", () => {
  it("parseVendorId：只认两个已知厂商，其余一律抛边界错误", () => {
    expect(parseVendorId("commandcode")).toBe("commandcode");
    expect(parseVendorId("dsh-opencode-go")).toBe("dsh-opencode-go");
    for (const value of HOSTILE) {
      let caught: unknown;
      try {
        parseVendorId(value);
      } catch (error) {
        caught = error;
      }
      if (caught === undefined) throw new Error(`parseVendorId accepted ${String(value)}`);
      // 必须是**边界错误**（说得出端点与字段），不是 TypeError 之类。
      expect((caught as Error).message, String(value)).toContain("boundary violation");
      expect((caught as Error).message, String(value)).toContain(USAGE_NAMESPACE);
    }
  });

  it("每个结果的解析器：结构不对就抛边界错误，绝不返回 undefined 冒充成功", () => {
    for (const descriptor of usageDescriptors()) {
      const parse = parserOf(descriptor);
      for (const value of HOSTILE) {
        const accepted = (() => {
          try {
            parse(value);
            return true;
          } catch {
            return false;
          }
        })();
        if (!accepted) continue;
        // `void` 端点接受任何值并归一到 undefined —— 那是它的契约，不算「冒充成功」。
        if (descriptor.method === "renameAccount" || descriptor.method === "replaceKey" || descriptor.method === "removeAccount" || descriptor.method === "moveAccount" || descriptor.method === "setAutoSwitch" || descriptor.method === "loginCancel" || descriptor.method === "selectAccount" || descriptor.method === "setAccountOrder" || descriptor.method === "setSwitchSettings" || descriptor.method === "setAccountModels") {
          expect(parse(value), descriptor.method).toBeUndefined();
          continue;
        }
        // 其余端点接受的载荷至少要是个对象（数组是账号/切换记录的合法形状）。
        const shape = typeof value === "object" && value !== null;
        expect(shape, `${descriptor.method} accepted ${JSON.stringify(value)}`).toBe(true);
      }
    }
  });

  it("合法载荷原样通过（解析不改写数据），且重复解析是恒等变换", () => {
    const cases: readonly { method: string; value: unknown }[] = [
      { method: "status", value: { vendor: "commandcode", accounts: [], failures: [] } },
      { method: "accounts", value: [] },
      { method: "accounts", value: [{ ref: "DSH_A", label: "A", configured: true, active: false, effective: false }] },
      { method: "switches", value: [] },
      { method: "loginStatus", value: { state: "idle" } },
      // 注意：addAccount 的**结果**是一条账号行（要 ref）；`{label, key}` 是它的**入参**形状。
      { method: "addAccount", value: { ref: "DSH_NEW", label: "A", configured: true, active: false, effective: false } },
      { method: "selectAccount", value: null },
      { method: "selectAccount", value: "DSH_A" },
      { method: "renameAccount", value: undefined },
      { method: "moveAccount", value: undefined },
    ];
    for (const item of cases) {
      const descriptor = usageDescriptors().find((candidate) => candidate.method === item.method)!;
      const parse = parserOf(descriptor);
      const once = parse(item.value);
      if (typeof once === "object" && once !== null) {
        expect(once, item.method).toEqual(item.value); // 不改写
        expect(parse(once), item.method).toEqual(once); // 幂等
      }
    }
  });

  it("错误消息里的取值描述：普通值给原文，序列化不了的也不让报错本身崩", () => {
    // 这条盯的是一个真实的自伤：`describeValue` 曾经被一次全局替换改成自递归，
    // 于是每条边界错误都先烧一次完整调用栈（栈溢出被 catch 接住），且消息里的值
    // 永远退化成 `[object Object]` —— 排查时等于没有信息。
    const messageOf = (value: unknown): string => {
      try {
        parseVendorId(value);
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    };
    // 普通值：消息里要有**原文**（不是类型名）。
    expect(messageOf("nope")).toContain('"nope"');
    expect(messageOf(42)).toContain("42");
    expect(messageOf({ a: 1 })).toContain('{"a":1}');
    // 序列化不了的：给类型名，且仍然是边界错误（不是 TypeError）。
    expect(messageOf(10n)).toMatch(/boundary violation/);
    expect(messageOf(10n)).not.toContain("call stack");
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(messageOf(circular)).toMatch(/boundary violation/);
  });

  it("错误消息点名端点（排查时知道是哪一条调用被拒）", () => {
    const endpoints: Record<string, string> = {
      status: "status",
      accounts: "accounts",
      switches: "switches",
      loginStatus: "login",
      addAccount: "addAccount",
    };
    for (const [method, endpoint] of Object.entries(endpoints)) {
      const descriptor = usageDescriptors().find((candidate) => candidate.method === method)!;
      try {
        parserOf(descriptor)({ nope: true });
        throw new Error(`${method} accepted a hostile payload`);
      } catch (error) {
        expect((error as Error).message, method).toContain(`${USAGE_NAMESPACE}/${endpoint}`);
      }
    }
  });
});

// —— 3. 边界数据 → 渲染（今天那类崩溃的系统性防线）————————

/**
 * 造一份「结构合法但字段可疑」的主机状态。
 *
 * 结构校验拦得住null/非对象，拦不住 `effective: null` / `pinned: null` /
 * `accounts: [null]` 这类「类型对、值可疑」的载荷 —— 而它们会一路流到渲染路径。
 */
function suspiciousStatus(overrides: Partial<Record<string, unknown>> = {}): VendorUsageStatus {
  return {
    vendor: "commandcode",
    capabilities: { reorder: true, pin: true, browserLogin: true, modelAccountRules: true, quotaShape: "windows", modelVisibilityWrite: "onSave", automaticSwitch: true },
    pinned: null,
    accounts: [],
    failures: [],
    ...overrides,
  } as unknown as VendorUsageStatus;
}

/** 渲染一棵树，返回可见文本；抛错就失败（渲染路径不许崩）。 */
function renderSafely(render: () => unknown): string[] {
  let tree: unknown;
  try {
    tree = render();
  } catch (error) {
    throw new Error(`the render path threw: ${(error as Error).message}`);
  }
  return textsOf(tree);
}

describe("边界数据到渲染", () => {
  it("可省略字段被序列化成 null 时，四张卡片都不崩", () => {
    const statuses: readonly VendorUsageStatus[] = [
      suspiciousStatus({ effective: null, pinned: null }),
      suspiciousStatus({ effective: null, pinned: "DSH_A" }),
      suspiciousStatus({ effective: { ref: "DSH_A", at: 1 }, pinned: null }),
      suspiciousStatus({ effective: { ref: "DSH_A", at: 1 }, pinned: "DSH_B", switch: null }),
      suspiciousStatus({ accounts: [], failures: null }),
      suspiciousStatus({ accounts: [], failures: [] }),
    ];
    for (const status of statuses) {
      const label = JSON.stringify({ effective: status.effective ?? null, pinned: status.pinned ?? null });
      // 四张卡片（两家账户卡片 + 侧边栏 + 仪表盘）都必须平安渲染。
      for (const render of [
        () => AccountCard({ status, t, action: undefined, expandedRef: undefined, login: undefined, onOpenAction: () => undefined, onActionField: () => undefined, onConfirmAction: () => undefined, onCancelAction: () => undefined, onSelect: () => undefined, onRemove: () => undefined, onToggleExpand: () => undefined, onLoginBegin: () => undefined }),
        () => OpenCodeAccountCard({ status, t, settings: {}, action: undefined, expandedRef: undefined, login: undefined, onOpenAction: () => undefined, onActionField: () => undefined, onConfirmAction: () => undefined, onCancelAction: () => undefined, onSelect: () => undefined, onRemove: () => undefined, onToggleExpand: () => undefined, onLoginBegin: () => undefined, onMove: () => undefined, onSetAutoSwitch: () => undefined }),
        () => SidebarCard({ t, status, onOpen: () => undefined }),
        () => Dashboard({ t, status, onClose: () => undefined }),
      ]) {
        const texts = renderSafely(render);
        for (const token of ["undefined", "NaN", "[object Object]"]) {
          expect(texts.some((text) => text.includes(token)), `${label} shows "${token}"`).toBe(false);
        }
      }
    }
  });

  it("账号行里的可疑值（null / 缺字段）不把卡片打垮", () => {
    const rows: readonly unknown[] = [
      null,
      {},
      { ref: "DSH_A" },
      { ref: "DSH_A", label: "A", configured: false, active: false, effective: false },
      { ref: "DSH_A", quota: null },
      { ref: "DSH_A", quota: { windows: null } },
      { ref: "DSH_A", quota: { windows: [] } },
      { ref: "DSH_A", quota: { windows: [{ key: "5h" }] } },
      { ref: "DSH_A", rejection: null },
      { ref: "DSH_A", rejection: { kind: "quota" } },
    ];
    for (const row of rows) {
      const status = suspiciousStatus({ accounts: [row] as unknown as AccountView[] });
      for (const render of [
        () => AccountCard({ status, t, action: undefined, expandedRef: undefined, login: undefined, onOpenAction: () => undefined, onActionField: () => undefined, onConfirmAction: () => undefined, onCancelAction: () => undefined, onSelect: () => undefined, onRemove: () => undefined, onToggleExpand: () => undefined, onLoginBegin: () => undefined }),
        () => Dashboard({ t, status, onClose: () => undefined }),
      ]) {
        const texts = renderSafely(render);
        for (const token of ["undefined", "NaN", "[object Object]"]) {
          expect(texts.some((text) => text.includes(token)), `${JSON.stringify(row)} shows "${token}"`).toBe(false);
        }
      }
    }
  });

  it("解析器放过的载荷确实能渲染（契约两头对齐）", () => {
    const descriptor = usageDescriptors().find((candidate) => candidate.method === "status")!;
    const parse = parserOf(descriptor);
    // 一份主机真实形状的状态：解析器必须收下，渲染必须不崩。
    const parsed = parse({ vendor: "commandcode", accounts: [], failures: [], pinned: null }) as VendorUsageStatus;
    expect(parsed).toBeDefined();
    expect(renderSafely(() => SidebarCard({ t, status: parsed, onOpen: () => undefined })).length).toBeGreaterThan(0);
    // 元素树里必须真的画出了东西（不是一棵空树）。
    expect(elementsOf(SidebarCard({ t, status: parsed, onOpen: () => undefined })).length).toBeGreaterThan(0);
  });
});