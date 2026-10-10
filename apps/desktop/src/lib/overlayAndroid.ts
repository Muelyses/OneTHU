/** 占位实现（Lead 放的骨架）：ball-overlay-android 直接整体替换本文件内容即可。
 *  契约见 lib/overlay.ts 的 OverlayAdapter。 */
import type { OverlayAdapter } from "./overlay.js";

const adapter: OverlayAdapter = {
  async supported() {
    return false;
  },
  async show() {
    /* TODO(ball-overlay-android) */
  },
  async hide() {
    /* TODO(ball-overlay-android) */
  },
  async setMode() {
    /* TODO(ball-overlay-android) */
  },
  async onEvent() {
    return () => undefined;
  },
};

export default adapter;
