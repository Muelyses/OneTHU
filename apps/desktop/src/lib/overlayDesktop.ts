/** 占位实现（Lead 放的骨架）：ball-overlay-desktop 直接整体替换本文件内容即可。
 *  契约见 lib/overlay.ts 的 OverlayAdapter。 */
import type { OverlayAdapter } from "./overlay.js";

const adapter: OverlayAdapter = {
  async supported() {
    return false;
  },
  async show() {
    /* TODO(ball-overlay-desktop) */
  },
  async hide() {
    /* TODO(ball-overlay-desktop) */
  },
  async setMode() {
    /* TODO(ball-overlay-desktop) */
  },
  async onEvent() {
    return () => undefined;
  },
};

export default adapter;
