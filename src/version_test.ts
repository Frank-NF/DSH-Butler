/**
 * 产品标识的守卫测试。
 *
 * 存在的理由：产品名会流进打包元数据、安装包、进程名与自更新链路。
 * 中文在这些环节会安静地炸 —— 旧项目「DSH插件管家」就因 WiX 的 en-US codepage 1252
 * 写不进中文而报 LGHT0311，表层只显示 "failed to run light.exe"，查了很久。
 * 所以「产品名必须纯 ASCII」是硬约束，必须有测试钉住，不能只靠注释提醒。
 */

import { assert, assertEquals } from "@std/assert";
import { APP_ID, APP_NAME, STAGE_LABEL, UI_WRITE_ENABLED } from "./version.ts";
import { INDEX_HTML } from "./web/markup.ts";

/** 是否全部落在可打印 ASCII 范围内（0x20–0x7E）。 */
function isPrintableAscii(s: string): boolean {
  return [...s].every((ch) => {
    const c = ch.codePointAt(0)!;
    return c >= 0x20 && c <= 0x7e;
  });
}

Deno.test("产品名必须是纯 ASCII（不能含中文）", () => {
  assert(
    isPrintableAscii(APP_NAME),
    `APP_NAME 含非 ASCII 字符，会在打包/安装环节出问题：${JSON.stringify(APP_NAME)}`,
  );
  assert(APP_NAME.trim().length > 0, "APP_NAME 不能为空");
});

Deno.test("产品名不含路径/文件名非法字符", () => {
  for (const bad of ["\\", "/", ":", "*", "?", '"', "<", ">", "|"]) {
    assert(
      !APP_NAME.includes(bad),
      `APP_NAME 不该包含 ${JSON.stringify(bad)}（会污染产物文件名）`,
    );
  }
});

Deno.test("APP_ID 保持反向域名格式且不可变", () => {
  // 这个值一旦改，会挪数据目录、丢用户配置、断掉自更新链 —— 见 version.ts 顶部铁律。
  assertEquals(APP_ID, "com.dsh.plugin-updater");
});

/*
 * 阶段标识的防腐测试。
 *
 * 存在的理由：阶段曾同时写死在三个地方（启动日志 S3 / 总览接口 S1 / 界面导航「只读版本 S1」），
 * 同一个程序自相矛盾。现在阶段只在 version.ts 里定义一次，这里钉住"界面必须引用它"，
 * 免得下次改阶段又漏掉界面那一份。
 */
Deno.test("阶段标识只有一个来源：界面骨架必须引用 STAGE_LABEL", () => {
  assert(
    INDEX_HTML.includes(STAGE_LABEL),
    `界面导航提示里找不到 STAGE_LABEL（${STAGE_LABEL}）—— 阶段文案又跑偏了`,
  );
  assert(
    !/只读版本（S1）|S1 只读阶段/.test(INDEX_HTML),
    "界面骨架里还留着写死的旧阶段文案 —— 阶段只能来自 version.ts",
  );
});

Deno.test("界面文案与写操作开关状态一致", () => {
  // 开关关着时界面不许宣称能写；开关打开后也不许再自称只读。
  assertEquals(INDEX_HTML.includes("只检测、不修改"), !UI_WRITE_ENABLED);
});
