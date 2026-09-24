# -*- coding: utf-8 -*-
"""DSH 管家 图标生产线（官方 VI 版）。

品牌标志 = 橙红 D + 奶白鲸鱼，取自 docs/DSH管家_品牌VI_assets 的 VI 板（已抠成透明 mark-raw.png）。
一份母版，产出全部尺寸：

  icons/icon.ico / icon.icns / 128x128.png / 512x512.png   应用图标
  icons/tray.ico / tray.png                                托盘（透明底）
  icons/whale-white.png                                    DSH 页面上那个悬浮条要用的纯白鲸鱼
  icons/build/tray-base64.txt                              托盘图标 base64（注入 desktop.ts 用）
  site/assets/logo.png / favicon.ico / apple-touch-icon.png 官网

要换品牌资产：把新标志抠成 icons/build/mark-raw.png（或改这个脚本里的抠图逻辑）再跑一次。
"""
import base64
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICONS = os.path.join(ROOT, "icons")
BUILD = os.path.join(ICONS, "build")
SITE = os.path.join(ROOT, "site", "assets")
os.makedirs(BUILD, exist_ok=True)
os.makedirs(SITE, exist_ok=True)

MARK = os.path.join(BUILD, "mark-raw.png")
mark = Image.open(MARK).convert("RGBA")
print("母版:", mark.size)

# 裁掉透明边，再统一按"内容占 86%"摆放，保证各尺寸视觉大小一致
bbox = mark.getbbox()
mark = mark.crop(bbox)
side = max(mark.size)
canvas = Image.new("RGBA", (side, side), (0, 0, 0, 0))
canvas.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2), mark)


def icon_at(size, ratio=0.86, bg=None, radius_ratio=0.0):
    """把标志按 ratio 摆在 size 见方的画布上；bg 给了就加圆角底。"""
    img = Image.new("RGBA", (size, size), bg if bg else (0, 0, 0, 0))
    if bg and radius_ratio:
        d = ImageDraw.Draw(img)
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=bg)
    inner = max(1, int(size * ratio))
    small = canvas.resize((inner, inner), Image.LANCZOS)
    off = (size - inner) // 2
    img.alpha_composite(small, (off, off))
    return img


# ── 应用图标 ────────────────────────────────────────────────────────
big = icon_at(1024)
big.resize((512, 512), Image.LANCZOS).save(os.path.join(ICONS, "512x512.png"))
big.resize((128, 128), Image.LANCZOS).save(os.path.join(ICONS, "128x128.png"))
sizes = [16, 24, 32, 48, 64, 128, 256]
big.save(os.path.join(ICONS, "icon.ico"), sizes=[(s, s) for s in sizes])
try:
    big.save(os.path.join(ICONS, "icon.icns"))
    print("icns ok")
except Exception as e:
    print("icns 失败:", e)

# ── 托盘：透明底、稍微放大一点，小尺寸下更醒目 ──────────────────────
tray = icon_at(256, ratio=0.94)
tray.resize((32, 32), Image.LANCZOS).save(os.path.join(ICONS, "tray.png"))
tray.save(os.path.join(ICONS, "tray.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])

# ── 界面内嵌用的小标志 ──────────────────────────────────────────────
# 界面里的标志（顶栏品牌位、悬浮条的按钮）都用这张位图，
# 理由：官方标志是"橙红 D + 负空间鲸鱼"，自己照着重画一版必然走形，不如直接用真标志。
chip = icon_at(64, ratio=0.94)
chip.save(os.path.join(ICONS, "mark-chip.png"))
chip.resize((32, 32), Image.LANCZOS).save(os.path.join(ICONS, "mark-32.png"))

# ── 官网资产 ────────────────────────────────────────────────────────
big.resize((512, 512), Image.LANCZOS).save(os.path.join(SITE, "logo.png"))
big.resize((180, 180), Image.LANCZOS).save(os.path.join(SITE, "apple-touch-icon.png"))
big.resize((64, 64), Image.LANCZOS).save(os.path.join(SITE, "icon-64.png"))
big.resize((32, 32), Image.LANCZOS).save(os.path.join(SITE, "favicon-32.png"))
big.resize((32, 32), Image.LANCZOS).save(
    os.path.join(SITE, "favicon.ico"), sizes=[(16, 16), (32, 32), (48, 48)]
)
# 深色底版本（官网/OG 图用）
dark = icon_at(1200, ratio=0.62, bg=(0x22, 0x21, 0x22, 255), radius_ratio=0.0)
dark.resize((1200, 630), Image.LANCZOS).save(os.path.join(SITE, "og-cover.png"))

# ── base64（给 desktop.ts 内嵌托盘图标用）──────────────────────────
with open(os.path.join(BUILD, "tray-base64.txt"), "w", encoding="utf-8") as f:
    f.write("PNG=" + base64.b64encode(open(os.path.join(ICONS, "tray.png"), "rb").read()).decode() + "\n")
    f.write("ICO=" + base64.b64encode(open(os.path.join(ICONS, "tray.ico"), "rb").read()).decode() + "\n")
with open(os.path.join(BUILD, "mark-base64.txt"), "w", encoding="utf-8") as f:
    f.write("CHIP=" + base64.b64encode(open(os.path.join(ICONS, "mark-chip.png"), "rb").read()).decode() + "\n")
print("完成：应用图标 / 托盘 / 悬浮条白鲸 / 官网资产 / base64")
