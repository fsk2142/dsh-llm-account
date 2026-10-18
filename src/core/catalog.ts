/**
 * 模型目录的可见性规则：厂商适配器在 `listModels` 输出前用它过滤目录，
 * 使宿主的模型选择器只看到用户允许的模型。
 *
 * 规则来源与旧插件一致，优先级固定为：
 * 1. 显式布尔覆盖（`modelVisibility[id]`）；
 * 2. 白名单非空时，按是否命中白名单（`visibleModels`）；
 * 3. 白名单缺省或为空时，全部可见。
 *
 * 纯函数、无 I/O、无状态；`normalizeVisibility` 只负责把不可信的原始值收敛成合法形状。
 * @module dsh-llm-account/src/core/catalog
 */

import type { CatalogEntry } from "./adapter";

/**
 * 一份可见性设置。
 *
 * `visibleModels` 白名单与 `modelVisibility` 逐模型开关都来自设置文档，
 * 因此读取时必须先经 {@link normalizeVisibility} 收敛。
 */
export interface Visibility {
  /** 白名单；缺省或空数组表示「不按白名单限制」，即全部可见。 */
  visibleModels?: readonly string[];
  /** 逐模型显式开关；只要该模型有布尔值就优先于白名单。 */
  modelVisibility?: Record<string, boolean>;
}

/** 判定一个值是否为「普通对象」（排除 `null` 与数组）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 把来源不可信的原始值收敛成合法形状。
 *
 * 只接受布尔值：`modelVisibility` 中非布尔的键值对被丢弃，一个合法项都不剩时整个字段省略；
 * `visibleModels` 中非字符串的元素被丢弃（字段本身仍是数组时保留，空数组表示全部可见）。
 * 非对象输入（`null` / 字符串 / 数字 / 数组）返回空可见性，即不做任何限制。
 *
 * **空串与纯空白一律丢弃**（白名单与显隐键两处）：`[""]` 会被当成「非空白名单」，
 * 让所有模型从选择器里消失 —— 旧插件 `storedAllowlist`（`lib/client.js` 第 1486 行）
 * 过滤 `m !== ""`、`readVisibility` 过滤 `id !== ""`，客户端 `normalizeModels`
 * 同样丢弃；三处对同一份字段的读法必须一致。
 * @param raw - 设置文档中的原始值。
 * @returns 收敛后的可见性设置；不修改入参。
 */
export function normalizeVisibility(raw: unknown): Visibility {
  if (!isRecord(raw)) return {};

  const result: Visibility = {};

  const list = raw.visibleModels;
  if (Array.isArray(list)) {
    result.visibleModels = list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
  }

  const map = raw.modelVisibility;
  if (isRecord(map)) {
    const allowed: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(map)) {
      if (typeof value === "boolean" && id.trim() !== "") allowed[id] = value;
    }
    if (Object.keys(allowed).length > 0) result.modelVisibility = allowed;
  }

  return result;
}

/**
 * 判定单个模型 id 是否可见。三条规则按优先级顺序短路，顺序即语义。
 *
 * 与 {@link isModelVisible} 是同一份实现的两个入口：设置页只有 id（目录里的模型再加上
 * 手工项），没有完整条目；两处各写一份规则迟早会分叉。
 * @param id - 模型 id。
 * @param visibility - 可见性设置（应已归一化）。
 * @returns 该 id 是否应出现在模型选择器里。
 */
export function isModelIdVisible(id: string, visibility: Visibility): boolean {
  // 规则 1：显式布尔覆盖优先于白名单——`false` 也必须生效，故判 `undefined` 而非真值。
  const override = visibility.modelVisibility?.[id];
  if (override !== undefined) return override;

  // 规则 2：白名单非空时，只有名单内的模型可见。
  const allow = visibility.visibleModels;
  if (allow !== undefined && allow.length > 0) return allow.includes(id);

  // 规则 3：白名单缺省或为空——没有显式选择，默认关闭（2026-10-18 用户要求：
  // 模型选择不能默认把所有模型都打开；勾选/按组开启后才进入选择器）。
  return false;
}

/**
 * 判定单个模型条目是否可见。
 * @param entry - 目录条目；按 `entry.id` 匹配。
 * @param visibility - 可见性设置（应已归一化）。
 * @returns 该条目是否应出现在目录里。
 */
export function isModelVisible(entry: CatalogEntry, visibility: Visibility): boolean {
  return isModelIdVisible(entry.id, visibility);
}

/**
 * 过滤目录，保持输入顺序。
 * @param entries - 待过滤的目录条目。
 * @param visibility - 可见性设置（应已归一化）。
 * @returns 新的条目数组；不修改 `entries`。
 */
export function selectVisible(entries: CatalogEntry[], visibility: Visibility): CatalogEntry[] {
  return entries.filter((entry) => isModelVisible(entry, visibility));
}
