/**
 * R03 第三版：**正文阶段的超时也要取消底层网络**。
 *
 * ## 报告指出的残留问题
 *
 * 1.6.3 修好了「等待响应头」那一段：挂了 headers 时 `fetch` 收到的 signal 会 abort。
 * 但收到 headers 之后，`withRequestDeadline` 已经返回、它自己的 timer 被清掉 ——
 * 后面的错误正文读取与 `runStream` 没有继续控制同一个网络 controller。实测：
 *
 * - 错误正文不结束 → 外层超时后 `reader.cancel = 0`，body 仍开；
 * - 成功正文输出一点后停住 → idle/整请求超时后原 signal 未 abort。
 *
 * ## 这一版的修法
 *
 * `RequestDeadline` 持有一个**跨阶段存活**的 controller；`run()` 与
 * `runStream` 共享它。任一段超时都 abort 同一个 controller，于是后续阶段
 * （和卡在 `read()` 上的 reader）都能看到取消。
 */
import { describe, expect, it } from "vitest";

import {
  LLM_REQUEST_TIMEOUT,
  LLM_STREAM_IDLE_TIMEOUT,
  RequestDeadline,
  runStream,
} from "../../src/core/transport";

describe("RequestDeadline 的共享网络取消（R03 第三版）", () => {
  it("**run() 超时会 abort 共享 controller**（后续阶段也能看到）", async () => {
    const deadline = new RequestDeadline(30);
    let networkAborted = false;
    /** 永不 resolve：模拟网关挂起。 */
    const hanging = new Promise<never>(() => {});
    const running = deadline.run(async (signal) => {
      signal?.addEventListener("abort", () => {
        networkAborted = true;
      });
      return hanging;
    }, 5_000);
    await expect(running).rejects.toMatchObject({ code: LLM_REQUEST_TIMEOUT });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(networkAborted, "**run() 超时必须 abort 共享网络**").toBe(true);
  });

  it("**流式阶段超时会调 abortNetwork**（正文停住时 socket 释放）", async () => {
    const deadline = new RequestDeadline(50);
    let networkAborted = false;
    const hanging = new Promise<never>(() => {});
    const drain = async (): Promise<void> => {
      for await (const _chunk of runStream(
        (async function* () {
          yield "first";
          await hanging; // 正文停住
        })(),
        deadline.streamBudget(40),
        {
          abortNetwork: () => {
            networkAborted = true;
            deadline.abort(new Error("idle timeout"));
          },
        },
      )) {
        // 消费第一个 chunk 之后卡住
      }
    };
    await expect(drain()).rejects.toMatchObject({ code: LLM_STREAM_IDLE_TIMEOUT });
    expect(networkAborted, "**流式超时必须调 abortNetwork**").toBe(true);
  });

  it("整请求超时也会调 abortNetwork（不只是空闲看门狗）", async () => {
    let networkAborted = false;
    const hanging = new Promise<never>(() => {});
    const drain = async (): Promise<void> => {
      for await (const _chunk of runStream(
        (async function* () {
          yield "first";
          await hanging;
        })(),
        /** 空闲预算给得很大，让整请求 deadline 先到。 */
        { requestTimeoutMs: 40, streamIdleTimeoutMs: 60_000 },
        {
          abortNetwork: () => {
            networkAborted = true;
          },
        },
      )) {
        // 卡住
      }
    };
    await expect(drain()).rejects.toMatchObject({ code: LLM_REQUEST_TIMEOUT });
    expect(networkAborted, "整请求超时同样要取消网络").toBe(true);
  });

  it("正常消费完**不** abort 网络", async () => {
    const deadline = new RequestDeadline(5_000);
    let networkAborted = false;
    const chunks: string[] = [];
    for await (const chunk of runStream(
      (async function* () {
        yield "a";
        yield "b";
      })(),
      deadline.streamBudget(5_000),
      {
        abortNetwork: () => {
          networkAborted = true;
        },
      },
    )) {
      chunks.push(chunk as string);
    }
    expect(chunks).toEqual(["a", "b"]);
    expect(networkAborted, "正常完成不该 abort").toBe(false);
  });

  it("networkAbort 是幂等的（重复调用无害）", () => {
    const deadline = new RequestDeadline(1_000);
    const abort = deadline.networkAbort();
    expect(() => {
      abort();
      abort();
      abort();
    }).not.toThrow();
  });
});
