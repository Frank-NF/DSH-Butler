/**
 * 把 .ico 写进编译产物的 exe（Windows PE 资源）。
 *
 * 【为什么需要】deno desktop 的 --icon 只作用在"载荷" dsh-butler.dll 上 ——
 * 从 dll 里能抠出我们的图标，但 Explorer / 桌面快捷方式看的是那个瘦壳 exe 的图标，
 * 于是用户看到的是白板图标。Windows 自己没有现成的命令行工具能改（rcedit 的 npm 包没有 bin），
 * 但 kernel32 的 BeginUpdateResource / UpdateResource / EndUpdateResource 就是干这个的，
 * 我们已经有 FFI 底子，直接调。
 *
 * 用法：deno run -A scripts/embed-exe-icon.ts <exe 路径> <ico 路径>
 */

const isWindows = Deno.build.os === "windows";
if (!isWindows) {
  console.log("非 Windows，跳过 exe 图标写入");
  Deno.exit(0);
}

const [exePath, icoPath] = Deno.args;
if (!exePath || !icoPath) {
  console.error("用法：deno run -A scripts/embed-exe-icon.ts <exe> <ico>");
  Deno.exit(2);
}

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

function wide(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) dv.setUint16(i * 2, s.charCodeAt(i), true);
  return buf;
}

/** 把整数当成资源 ID 指针（Win32 的 MAKEINTRESOURCE）。 */
function resId(id: number): Deno.PointerValue {
  return Deno.UnsafePointer.create(BigInt(id));
}

interface IcoImage {
  width: number;
  height: number;
  colorCount: number;
  planes: number;
  bitCount: number;
  bytes: Uint8Array;
}

/** 拆开 .ico：拿到每张图的原始数据与元信息。 */
function parseIco(data: Uint8Array): IcoImage[] {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const reserved = dv.getUint16(0, true);
  const type = dv.getUint16(2, true);
  const count = dv.getUint16(4, true);
  if (reserved !== 0 || type !== 1 || count === 0) {
    throw new Error("不是合法的 .ico 文件");
  }
  const out: IcoImage[] = [];
  for (let i = 0; i < count; i++) {
    const off = 6 + i * 16;
    const width = data[off] === 0 ? 256 : data[off]!;
    const height = data[off + 1] === 0 ? 256 : data[off + 1]!;
    const colorCount = data[off + 2]!;
    const planes = dv.getUint16(off + 4, true);
    const bitCount = dv.getUint16(off + 6, true);
    const size = dv.getUint32(off + 8, true);
    const offset = dv.getUint32(off + 12, true);
    out.push({
      width,
      height,
      colorCount,
      planes,
      bitCount,
      bytes: data.subarray(offset, offset + size),
    });
  }
  return out;
}

const kernel32 = Deno.dlopen("C:\\Windows\\System32\\kernel32.dll", {
  BeginUpdateResourceW: { parameters: ["pointer", "i32"], result: "pointer" },
  UpdateResourceW: {
    parameters: ["pointer", "pointer", "pointer", "u16", "pointer", "u32"],
    result: "i32",
  },
  EndUpdateResourceW: { parameters: ["pointer", "i32"], result: "i32" },
});

const ico = parseIco(Deno.readFileSync(icoPath));
console.log(`图标：${ico.length} 张（${ico.map((x) => x.width + "x" + x.height).join(", ")}）`);

const exe = Deno.readFileSync(exePath);
console.log(`目标：${exePath}（${(exe.length / 1024).toFixed(0)} KB）`);

const handle = kernel32.symbols.BeginUpdateResourceW(Deno.UnsafePointer.of(wide(exePath)), 0);
if (!handle) throw new Error("BeginUpdateResourceW 失败（文件只读或没有权限？）");

let lang = 0;
try {
  for (let i = 0; i < ico.length; i++) {
    const img = ico[i]!;
    const ok = kernel32.symbols.UpdateResourceW(
      handle,
      resId(RT_ICON),
      resId(i + 1),
      0,
      Deno.UnsafePointer.of(img.bytes),
      img.bytes.length,
    );
    if (!ok) throw new Error(`写 RT_ICON #${i + 1} 失败`);
  }
  // GRPICONDIR：告诉 Windows 这些 RT_ICON 是一组、按什么尺寸排
  const group = new Uint8Array(6 + ico.length * 14);
  const gv = new DataView(group.buffer);
  gv.setUint16(0, 0, true);
  gv.setUint16(2, 1, true);
  gv.setUint16(4, ico.length, true);
  for (let i = 0; i < ico.length; i++) {
    const img = ico[i]!;
    const off = 6 + i * 14;
    group[off] = img.width === 256 ? 0 : img.width;
    group[off + 1] = img.height === 256 ? 0 : img.height;
    group[off + 2] = img.colorCount;
    group[off + 3] = 0;
    gv.setUint16(off + 4, img.planes || 1, true);
    gv.setUint16(off + 6, img.bitCount || 32, true);
    gv.setUint32(off + 8, img.bytes.length, true);
    gv.setUint16(off + 12, i + 1, true);
  }
  const okGroup = kernel32.symbols.UpdateResourceW(
    handle,
    resId(RT_GROUP_ICON),
    resId(1),
    0,
    Deno.UnsafePointer.of(group),
    group.length,
  );
  if (!okGroup) throw new Error("写 RT_GROUP_ICON 失败");
  lang = 1;
} finally {
  // discard=0 表示真正落盘；失败时传 1 丢弃，别把 exe 写坏
  const done = kernel32.symbols.EndUpdateResourceW(handle, lang === 1 ? 0 : 1);
  if (!done) {
    console.error("EndUpdateResourceW 失败");
    Deno.exit(1);
  }
}
console.log("已写入 exe 图标资源");
