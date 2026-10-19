/**
 * 渲染兜底：**子组件**抛错也不许把宿主页面带走。
 *
 * 为什么必须是一层真正的 React 错误边界，而不是 `try { component() } catch`：后者只覆盖
 * 「调用本组件函数」这一次求值，而 React 是在**之后**的工作循环里逐个渲染子组件的 ——
 * 账号行、额度条、用量块都在那一步才求值。那里一抛，最近的错误边界接住（没有就整棵根树
 * 卸载），症状就是用户报的「每次刷新用量统计，整个设置页消失」。
 *
 * 边界自己渲染成一块可读面板并留一个「重试」：错误是一次具体的渲染失败，重试是有意义的
 * （数据变了就可能好了），比让用户关掉设置页再来一次好。
 * @module dsh-llm-account/src/client/boundary
 */
import { Component, createElement, type ErrorInfo, type ReactElement, type ReactNode } from "react";

import { CSS_CLASS } from "./css";

/** 边界属性。 */
export interface RenderBoundaryProps {
  /** 出问题时面板上显示的标题（取词由调用方给 —— 边界里不碰 `t()`，取词本身可能就是病因）。 */
  title?: string;
  /** 面板上的一句说明。 */
  note?: string;
  /** 重试按钮的文案。 */
  retryLabel?: string;
  /** 面板的 `data-` 标记（测试与样式用）。 */
  mark?: string;
  /**
   * 版式。
   *
   * - `panel`（缺省）：整页级别的兜底，带标题、说明与可滚动的诊断块；
   * - `inline`：**嵌在账号行里**的一小块统计失败 —— 一句话加一个重试就好，摆个整块面板
   *   会把一行账号撑成一屏，比失败本身更糟。
   */
  variant?: "panel" | "inline";
  children?: ReactNode;
}

/** 边界状态。 */
interface RenderBoundaryState {
  /** 捕获到的异常；`undefined` 表示正常。 */
  failure?: unknown;
}

/**
 * 一层错误边界。
 *
 * 只挡住**子树**：边界自身与它之上的宿主界面（设置页的其它分组、侧边栏）不受影响。
 */
export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  /** 由 React 在渲染期抛出后调用（把异常记进 state，渲染期换成面板）。 */
  static getDerivedStateFromError(error: unknown): RenderBoundaryState {
    return { failure: error };
  }

  /** 初始状态：正常渲染。 */
  override state: RenderBoundaryState = {};

  /**
   * 记一条控制台日志。
   *
   * 面板上的消息可能被用户一句「页面坏了」盖过去，控制台这条带组件栈，排障时要的就是它。
   * @param error - 捕获到的异常。
   * @param info - React 给的组件栈。
   */
  override componentDidCatch(error: unknown, info?: ErrorInfo): void {
    console.error("[dsh-llm-account] the settings page subtree crashed while rendering:", error, info?.componentStack);
  }

  /** 渲染子树或失败面板。 */
  override render(): ReactNode {
    const failure = this.state?.failure;
    if (failure === undefined) return this.props.children;
    return failurePanel(this.props, failure, () => {
      // 测试替身里没有 `setState`（它不是真正的 React）：没有就什么都不做，面板留着。
      if (typeof this.setState === "function") this.setState({ failure: undefined });
    });
  }
}

/**
 * 失败面板。
 * @param props - 边界的文案。
 * @param failure - 捕获到的异常。
 * @param retry - 重置边界，重新尝试渲染。
 * @returns 面板元素。
 */
function failurePanel(props: RenderBoundaryProps, failure: unknown, retry: () => void): ReactElement {
  const detail = failure instanceof Error ? (failure.stack ?? failure.message) : String(failure);
  const mark = props.mark ?? "data-render-error";
  if (props.variant === "inline") {
    return createElement(
      "p",
      { [mark]: "true", "data-render-error-inline": "true", className: CSS_CLASS.failure },
      `${props.title ?? "这一块"}渲染失败：${failure instanceof Error ? failure.message : String(failure)}`,
      createElement(
        "button",
        { type: "button", "data-boundary-retry": "true", className: CSS_CLASS.buttonGhost, onClick: retry },
        props.retryLabel ?? "重试",
      ),
    );
  }
  return createElement(
    "section",
    { [mark]: "true", className: CSS_CLASS.boundary },
    createElement("h2", null, props.title ?? "LLM 账号"),
    createElement("p", { className: CSS_CLASS.note }, props.note ?? "这一块渲染失败了，其余设置不受影响。"),
    createElement("pre", { className: CSS_CLASS.diagnostic }, detail),
    createElement(
      "button",
      { type: "button", "data-boundary-retry": "true", className: CSS_CLASS.buttonSecondary, onClick: retry },
      props.retryLabel ?? "重试",
    ),
  );
}
