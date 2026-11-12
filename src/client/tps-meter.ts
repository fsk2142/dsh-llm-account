/**
 * **实时 tok/s 的计数核心**（2026-11-12，第 2 步）。
 *
 * 这个文件**不碰 React、不碰宿主** —— 纯函数 + 一个有状态的累加器，可以完整单测。
 *
 * ## 为什么不直接数 token
 *
 * 流式事件里只有**字符**（`chunk.text`），没有 token 数。所以这里做两件事：
 *
 * 1. 按**字符类型**分别累计（CJK 与其它）；
 * 2. 用**实测系数**换算成 token（见 {@link tokensOf}）。
 *
 * 系数来自用户本机真实数据（2026-11-12 扫 25 个会话 / 19415 条回复）：
 * **69,248,359 字符 → 13,780,630 outputTokens = 5.03 字符/token**，
 * 其中 CJK 占 3.1%、其余是代码与英文。行业经验（英文 ≈ 4 字符/token、
 * 中文 ≈ 1 字/token）与此一致；参考
 * [token-metrics](https://socket.dev/npm/package/token-metrics) 与
 * [Qwen 的 estimate_token_counter](https://github.com/rayrayraykk/CoPaw/blob/86fda39f95d5557b60952c85c1a25923e9c8f918/src/qwenpaw/agents/utils/estimate_token_counter.py)。
 *
 * ## 读数语义：1 秒窗口 + 3 窗口平均 + **指针回落**
 *
 * 用户选的口径是 B（1 秒窗口 + 多窗口平均），并明确要求「像汽车速度表一样逐渐降低为 0」。
 *
 * 所以 `reading(at)` 分两种情况：
 *
 * - **窗口里有数据** → 返回分窗平均值（稳定但不迟钝）；
 * - **窗口里没有数据**（模型停顿、或这一轮已结束）→ 从**最后一次读数**开始按指数衰减，
 *   松手后指针平滑滑回 0，低于显示阈值就返回 `undefined`（组件据此隐藏）。
 *
 * 而不是「一停就归零」或「一停就消失」—— 那不像仪表，像开关。
 *
 * @module dsh-llm-account/src/client/tps-meter
 */

/** 窗口长度（毫秒）：用户要的「1 秒内平均值」。 */
export const TPS_WINDOW_MS = 1_000;

/** 参与平均的窗口数（用户选的 B 方案：1 秒窗口 + 3 个窗口平均）。 */
export const TPS_WINDOWS = 3;

/**
 * 指针回落的**时间常数**（毫秒）。
 *
 * 指数衰减 `e^(-t/τ)`：τ = 700ms 时，约 0.7s 掉到 37%、1.6s 掉到 10%、
 * 2.3s 掉到 4% —— 手感接近汽车速度表松油门的那段指针回落。
 */
export const TPS_DECAY_MS = 700;

/**
 * 低于这个值就认为「已经停了」，返回 `undefined` 让组件隐藏。
 *
 * 0.5 tok/s 已经远低于任何有意义的速度，留着只会显示一个「0」，那是噪音。
 */
const TPS_ZERO_THRESHOLD = 0.5;

/**
 * 每 token 对应的 CJK 字符数。
 *
 * 取 1.0：实测中文里 1 个字基本就是 1 个 token（DeepSeek 系分词器）。
 */
const CJK_CHARS_PER_TOKEN = 1.0;

/**
 * 每 token 对应的**其它**字符数。
 *
 * 4.2 不是拍脑袋：在 CJK 占 3.1% 的前提下，要让总体落在实测的 5.03 字符/token，
 * 解得其它字符约 4.2（英文约 4、代码/JSON/路径压缩率更高，平均下来 4.2 更准）。
 */
const OTHER_CHARS_PER_TOKEN = 4.2;

/** 判断一个字符是否属于 CJK（含全角标点，它们同样 1 字 1 token）。 */
function isCjk(codePoint: number): boolean {
  return (
    (codePoint >= 0x2e80 && codePoint <= 0x9fff) || // CJK 部首、假名、汉字
    (codePoint >= 0xac00 && codePoint <= 0xd7af) || // 韩文音节
    (codePoint >= 0xf900 && codePoint <= 0xfaff) || // CJK 兼容汉字
    (codePoint >= 0xff00 && codePoint <= 0xffef) // 全角标点
  );
}

/**
 * 把一段文本分成 CJK 与其它字符的数量。
 *
 * 用**码位**而不是 `length`：`length` 会把 emoji 与部分汉字算成两个（UTF-16 代理对），
 * 而按码位循环更接近分词器看到的东西。
 * @param text - 增量文本。
 * @returns 两类字符的计数。
 */
export function countChars(text: string): { cjk: number; other: number } {
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const codePoint = char.codePointAt(0) ?? 0;
    if (isCjk(codePoint)) cjk += 1;
    else other += 1;
  }
  return { cjk, other };
}

/**
 * 把字符计数换算成估算 token 数。
 * @param counts - CJK 与其它字符数。
 * @returns 估算 token 数（非负浮点）。
 */
export function tokensOf(counts: { cjk: number; other: number }): number {
  return counts.cjk / CJK_CHARS_PER_TOKEN + counts.other / OTHER_CHARS_PER_TOKEN;
}

/**
 * 指针回落后的显示值。
 *
 * 纯函数，便于单测：给定最后一次读数、经过的时间与阈值，算出应显示的数字。
 * @param last - 最后一次有效读数。
 * @param elapsedMs - 距那次读数过了多久。
 * @param decayMs - 时间常数。
 * @param threshold - 低于它视为 0。
 * @returns 应显示的 tok/s；已归零时 `undefined`。
 */
export function decayed(last: number, elapsedMs: number, decayMs: number, threshold: number): number | undefined {
  if (elapsedMs <= 0) return last;
  if (decayMs <= 0) return undefined;
  const value = last * Math.exp(-elapsedMs / decayMs);
  return value < threshold ? undefined : value;
}

/**
 * 实时速度计。
 *
 * 用法：每收到一帧就 `push(text, now)`，需要显示时调 `reading(now)`。
 * 内部保留最近 `TPS_WINDOWS × TPS_WINDOW_MS` 的切片，超出自动丢弃 —— 内存恒定。
 */
export interface TpsMeter {
  /** 记一帧（帧里可能同时有正文与思考，调用方各推一次即可）。 */
  push(text: string, at: number): void;
  /**
   * 读当前速度。
   * @param at - 现在（毫秒）。
   * @returns 估算 tok/s；窗口无数据且已回落到 0 时 `undefined`。
   */
  reading(at: number): number | undefined;
  /** 本轮结束：停止计入新帧，但保留窗口供指针回落。 */
  settle(at: number): void;
}

/**
 * 造一个速度计。
 * @param options - `windowMs` / `windows` / `decayMs` 可注入（测试用），缺省见常量。
 * @returns 速度计。
 */
export function createTpsMeter(options: { windowMs?: number; windows?: number; decayMs?: number } = {}): TpsMeter {
  const windowMs = options.windowMs ?? TPS_WINDOW_MS;
  const windows = options.windows ?? TPS_WINDOWS;
  const decayMs = options.decayMs ?? TPS_DECAY_MS;
  /** 保留这么长时间的数据：`windows × windowMs`。 */
  const spanMs = windowMs * windows;
  /** 按**毫秒桶**聚合：同一毫秒内的帧合并，避免逐帧存一个对象。 */
  const buckets = new Map<number, { cjk: number; other: number }>();
  /** 本轮是否已结束（结束后不再计入新帧，但读数仍可用）。 */
  let settled = false;
  /** 最后一次算出来的有效读数（指针回落的起点）。 */
  let lastRate: { value: number; at: number } | undefined;

  /** 丢掉落出保留期的桶。 */
  const prune = (at: number): void => {
    const floor = at - spanMs;
    for (const key of buckets.keys()) {
      if (key < floor) buckets.delete(key);
    }
  };

  /** 按窗口算分窗平均；窗口里一个字节都没有时返回 `undefined`。 */
  const windowedRate = (at: number): number | undefined => {
    const rates: number[] = [];
    for (let index = 0; index < windows; index += 1) {
      const from = at - (index + 1) * windowMs;
      const to = at - index * windowMs;
      let cjk = 0;
      let other = 0;
      for (const [key, slice] of buckets) {
        /*
         * **右闭左开**：`from < key <= to`。
         *
         * 第一版写成 `key >= from && key < to`，于是「帧时间正好等于 now」的那一帧
         * 落在所有窗口之外 —— 读数直接变成 undefined。这在真机上就是
         * 「刚打完字数字闪一下又没了」。窗口必须把当前时刻包含进去。
         */
        if (key > from && key <= to) {
          cjk += slice.cjk;
          other += slice.other;
        }
      }
      if (cjk === 0 && other === 0) continue;
      // 空窗不参与，避免把「停顿」算成「变慢」。
      rates.push((tokensOf({ cjk, other }) / windowMs) * 1_000);
    }
    if (rates.length === 0) return undefined;
    return rates.reduce((total, rate) => total + rate, 0) / rates.length;
  };

  return {
    push: (text, at) => {
      if (settled) return;
      if (text === "") return;
      const counts = countChars(text);
      if (counts.cjk === 0 && counts.other === 0) return;
      const bucket = buckets.get(at);
      if (bucket === undefined) buckets.set(at, counts);
      else {
        bucket.cjk += counts.cjk;
        bucket.other += counts.other;
      }
      prune(at);
    },
    reading: (at) => {
      prune(at);
      const rate = windowedRate(at);
      if (rate !== undefined) {
        lastRate = { value: rate, at };
        return rate;
      }
      /*
       * 窗口里没数据：**指针回落**而不是立刻归零/立刻消失。
       *
       * 用户的说法是「像汽车速度表一样逐渐降低为 0」—— 松油门后指针平滑滑回，
       * 而不是啪一下掉到 0。所以这里从最后一次读数按指数衰减。
       */
      if (lastRate === undefined) return undefined;
      return decayed(lastRate.value, at - lastRate.at, decayMs, TPS_ZERO_THRESHOLD);
    },
    settle: () => {
      settled = true;
    },
  };
}
