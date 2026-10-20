/**
 * 用量页的两个小块：**失败明细**与**导出按钮**。
 *
 * 为什么单独一个文件：两者都只在用量区域出现，且都是纯 props → 元素树（不取数、不留状态），
 * 与 `usage-card` 的版式主体分开更好读。
 *
 * ## 失败明细
 *
 * 台账一直记着 `failureKind`（实测出现过 `network`），但界面从来没读过它 —— 用户只看到一个
 * 「成功率 99.6%」，报障时无从判断是网络抖动、限额，还是凭据失效。把已经落盘的原因显示出来，
 * 排查成本几乎全在这里。
 *
 * 分类名复用 `rejection.<kind>` 那套文案（拒绝表与失败明细说的是同一件事）；**认不出的分类
 * 原样显示** —— 编一个中文名会把「分类器不认识它」这个有用的事实藏起来。
 *
 * @module dsh-llm-account/src/client/failure-list
 */
import { createElement, type ReactElement } from "react";

import { CSS_CLASS } from "./css";
import { rejectionText } from "./copy";

/** 一类失败的展示行（来自报表的 `failuresByKind`）。 */
export interface FailureKindRowView {
  kind: string;
  count: number;
  lastAt: number;
  lastAccount: string;
}

/** 失败明细的属性。 */
export interface FailureKindListProps {
  t: (key: string) => string;
  /** 聚合层已经排好序；界面**不重排**。 */
  rows: readonly FailureKindRowView[];
}

/**
 * 一个失败分类的展示名。
 *
 * 与 {@link rejectionText} 的差别只有一处：**未收录的分类原样返回键名**，而不是「未知」。
 * 失败明细是排障界面，用户最需要知道的就是「出现了一个我没想到的原因」；
 * 把它显示成「未知」等于把这个信号抹掉。（账户卡片的拒绝状态仍用 `rejectionText`：
 * 那里空间小，显示键名会挤坏版式。）
 * @param t - 取词函数。
 * @param kind - 失败分类（形状不可信）。
 * @returns 展示名。
 */
function failureKindLabel(t: (key: string) => string, kind: string): string {
  const text = rejectionText(t, kind);
  return text === t("dashboard.unknown") ? kind : text;
}

/**
 * 失败明细。
 *
 * 一条失败都没有时返回 `null`：不给用户一行「失败 0 次」——那既不是他想看的信息，
 * 也会让「没有失败」与「明细读不到」长得不一样（两者都该安静）。
 * @param props - 文案与明细行。
 * @returns 元素树，或 `null`。
 */
export function FailureKindList(props: FailureKindListProps): ReactElement | null {
  if (props.rows.length === 0) return null;
  return createElement(
    "div",
    { "data-failure-kinds": "true", className: CSS_CLASS.usageFoot },
    createElement("small", { className: CSS_CLASS.usageMuted }, props.t("usage.failuresTitle")),
    ...props.rows.map((row) =>
      createElement(
        "small",
        {
          key: row.kind,
          "data-failure-kind": row.kind,
          "data-failure-count": row.count,
          className: CSS_CLASS.usageMuted,
        },
        // 已知分类走文案；未收录的分类**原样显示键名** —— 编一个「未知」会把
        // 「分类器遇到新原因」这个有用的事实藏起来（那正是最该被看见的时候）。
        `${failureKindLabel(props.t, row.kind)} × ${row.count}`,
      ),
    ),
  );
}

/** 导出按钮的属性。 */
export interface UsageExportButtonProps {
  t: (key: string) => string;
  /** 缺省表示当前宿主没有导出能力 —— 那就**不渲染**按钮（不留一个点了没反应的入口）。 */
  onExport?: (() => void) | undefined;
  /** 导出进行中。 */
  busy?: boolean;
}

/**
 * 台账导出按钮。
 * @param props - 文案、回调与进行中标记。
 * @returns 元素树，或 `null`（没有导出能力时）。
 */
export function UsageExportButton(props: UsageExportButtonProps): ReactElement | null {
  const onExport = props.onExport;
  if (onExport === undefined) return null;
  const busy = props.busy === true;
  return createElement(
    "button",
    {
      type: "button",
      "data-usage-export": "true",
      disabled: busy,
      // 与项目里其余按钮同一档样式（`buttonSm` 是次级小按钮）。
      className: `${CSS_CLASS.buttonSecondary} ${CSS_CLASS.buttonSm}`,
      onClick: () => onExport(),
    },
    busy ? props.t("usage.exporting") : props.t("usage.exportCsv"),
  );
}
