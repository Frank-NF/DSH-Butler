/** 版本号白名单的回归测试。【安全 SEC-02】 */
import { assertEquals } from "@std/assert";
import { validVersion } from "./mutate.ts";

Deno.test("版本号白名单：放行正常版本，拒绝注入形状", () => {
  for (const v of ["1.0.0", "3.26.5", "v2.0.0-rc.1", "1.2.3+build.7", "latest"]) {
    assertEquals(validVersion(v), true, `应放行 ${v}`);
  }
  for (const v of ["1.0.0&whoami", "1.0.0|calc", "a>b", "1.0.0%PATH%", 'a"b', "1.0.0 2.0.0", "", "-"]) {
    assertEquals(validVersion(v), false, `应拒绝 ${v}`);
  }
});
