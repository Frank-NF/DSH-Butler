/**
 * 「npm 安装源 / 网络代理」设置是否真的接进 npm 调用的回归测试。
 * 【2026-09-25 审计 SEC-16】这两个设置以前只存不用，界面上等于空承诺。
 */
import { assertEquals } from "@std/assert";
import type { AppConfig } from "../state/config.ts";
import { npmSourceArgs } from "./mutate.ts";

Deno.test("安装源与代理：设置会变成 npm 参数", () => {
  const reg = { npmRegistry: "https://registry.npmmirror.com", proxyUrl: "" } as AppConfig;
  assertEquals(npmSourceArgs(reg), ["--registry", "https://registry.npmmirror.com"]);

  const proxy = { npmRegistry: "", proxyUrl: "http://127.0.0.1:7890" } as AppConfig;
  assertEquals(npmSourceArgs(proxy), [
    "--proxy",
    "http://127.0.0.1:7890",
    "--https-proxy",
    "http://127.0.0.1:7890",
  ]);

  const both = { npmRegistry: "https://r.example.com", proxyUrl: "http://p.example.com:1080" } as AppConfig;
  assertEquals(npmSourceArgs(both), [
    "--registry",
    "https://r.example.com",
    "--proxy",
    "http://p.example.com:1080",
    "--https-proxy",
    "http://p.example.com:1080",
  ]);

  const blank = { npmRegistry: "   ", proxyUrl: "" } as AppConfig;
  assertEquals(npmSourceArgs(blank), [], "留空就不该塞参数（默认走官方源、直连）");
});
