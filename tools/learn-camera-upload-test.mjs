/**
 * 网络学堂「拍照直接上传」护栏（R21c，参照雨课堂作答编辑器 §32.1 的实现口径）。
 *
 * [1] 相机入口用 capture=environment 隐藏 file input 直调后置相机
 * [2] 判定走多信号 isAndroidNavigator（主窗口 UA 被伪装成 Windows，裸 UA 恒 false）
 * [3] 拍完必须并入既有提交流（setSubFile），不得另起一套上传实现
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../apps/desktop/src/pages/learn/AssignmentDetailPage.tsx", import.meta.url), "utf8");

/* ---------- [1] 相机入口 ---------- */
assert.ok(/ref=\{cameraRef\}/.test(page), "必须有 cameraRef 隐藏入口");
assert.ok(/type="file"\s+accept="image\/\*"\s+capture="environment"/.test(page.replace(/\n\s+/g, " ")),
  "相机入口必须是 accept=image/* + capture=environment");
assert.ok(/cameraRef\.current\?\.click\(\)/.test(page), "按钮必须经隐藏 input 触发");

/* ---------- [2] 平台判定 ---------- */
assert.ok(page.includes("isAndroidNavigator"), "必须用多信号 isAndroidNavigator");
assert.ok(!/\b\/android\/i\s*\.test\(navigator\.userAgent\)/.test(page) && !page.includes('includes("Android")'),
  "禁止裸 UA 判安卓（UA 被伪装，真机恒 false）");
assert.ok(/\{\s*isAndroid \?/.test(page.replace(/\n\s+/g, " ")), "相机入口必须只在 Android 宿主展示");

/* ---------- [3] 复用既有提交流 ---------- */
assert.ok(/if \(f\) setSubFile\(f\);/.test(page), "拍完的照片必须走 setSubFile（与选文件同一条路）");
const camBlock = page.slice(page.indexOf("ref={cameraRef}"), page.indexOf("📷 拍照上传"));
assert.ok(!/learn\.|await invoke|upload/.test(camBlock), "相机 onChange 不得直接调用上传（须复用既有提交流）");

console.log("learn-camera-upload-test: 全部断言通过（capture 相机入口 + 多信号判定 + 复用提交流）");
