import { useLocale as useUiLocale } from "../i18n/index.js";
import type { ReactNode } from "react";
import { useThemes } from "../state/theme.js";

/** (One / THU) 品牌标识：五列网格，括号代码体，One 衬线紧凑撑满与 THU 逐列对齐。
 *  主题插件可整体替换（theme.logo 提供 inline SVG 时优先渲染）。
 *  卡片、登录页、顶栏共用这一份，避免各处再写一遍品牌字。 */
export function BrandLogo({ size = 14, className }: { size?: number; className?: string }): ReactNode {
  const uiLocale = useUiLocale();

  const themed = useThemes().logoSvg;
  if (themed) {
    return (
      <span
        className={`brand-logo brand-logo-themed${className ? " " + className : ""}`}
        style={{ fontSize: size, display: "inline-flex", alignItems: "center" }}
        aria-label="OneTHU"
        /* 主题受信代码，同插件边界 */
        dangerouslySetInnerHTML={{ __html: themed }}
      />
    );
  }
  return (
    <span className={`brand-logo${className ? " " + className : ""}`} style={{ fontSize: size }} aria-label="OneTHU">
      <span className="p">(</span>
      <span className="word"><i>O</i><i>n</i><i>e</i></span>
      <span />
      <span className="p"> </span>
      <span className="u">T</span>
      <span className="u">H</span>
      <span className="u">U</span>
      <span className="p">)</span>
    </span>
  );
}
