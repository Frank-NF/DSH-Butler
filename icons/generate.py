# -*- coding: utf-8 -*-
"""DSH 管家 图标生成器（橙红小鲸鱼）。

一份几何、两处产物：
  - icons/whale.svg     矢量母版（VI 用；改颜色/形状以这里为准）
  - icons/128x128.png   应用图标（圆角方砖 + 鲸鱼）
  - icons/icon.ico      Windows 多尺寸（16/24/32/48/64/128/256）
  - icons/icon.icns     macOS
  - icons/tray.ico      托盘专用（透明底、无方砖，16/24/32）
  - icons/tray.png      托盘 PNG（内嵌进代码的 base64 也来自这里）

几何定义在 256×256 的坐标系里，鲸鱼朝右、居中。
只依赖 Pillow；曲线用贝塞尔采样成多边形，再按 4 倍超采样画出来（边缘干净）。
"""
import math
import os
from PIL import Image, ImageDraw

BRAND = (244, 97, 35, 255)        # --brand #F46123
BRAND_DEEP = (194, 65, 12, 255)   # --brand-fill #C2410C
INK = (32, 29, 26, 255)           # 深色墨（眼睛）
CREAM = (255, 240, 232, 255)      # 奶油白（水柱/高光）
TILE_DARK = (31, 30, 27, 255)     # 暖黑方砖
TILE_LIGHT = (251, 246, 242, 255) # 暖白方砖
S = 4                             # 超采样倍数
N = 256                           # 设计坐标空间


def bez(p0, p1, p2, p3, steps=28):
    out = []
    for i in range(1, steps + 1):
        t = i / steps
        u = 1 - t
        x = u**3 * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t**3 * p3[0]
        y = u**3 * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t**3 * p3[1]
        out.append((x, y))
    return out


def body_polygon():
    """鲸鱼身体：圆头 → 背脊 → 尾根 → 圆肚皮 → 回到嘴。

    要点（让它像鲸不像鱼）：头又圆又大、身体短而厚、尾根细、肚子圆弧饱满。
    """
    pts = [(50, 148)]
    pts += bez((50, 148), (46, 108), (78, 88), (118, 88))      # 头顶 → 背
    pts += bez((118, 88), (156, 88), (186, 100), (200, 118))   # 背 → 尾根上
    pts.append((208, 134))                                     # 尾根（细）
    pts.append((200, 152))                                     # 尾根下
    pts += bez((200, 152), (186, 176), (156, 190), (118, 190)) # 肚皮（后）
    pts += bez((118, 190), (78, 190), (48, 178), (50, 148))    # 肚皮（前）→ 嘴
    return pts


def tail_polygon():
    """尾鳍：两片圆润的尾叶 + 中间缺口（鲸的尾叶是横向摊开的，不是尖三角）。"""
    pts = [(200, 120)]
    pts += bez((200, 120), (218, 104), (238, 92), (246, 96), steps=14)   # 上叶外缘
    pts += bez((246, 96), (250, 112), (242, 126), (232, 132), steps=14)  # 上叶回勾
    pts.append((210, 138))                                              # 缺口
    pts += bez((210, 138), (232, 144), (248, 158), (248, 172), steps=14) # 下叶外缘
    pts += bez((248, 172), (240, 190), (214, 184), (198, 166), steps=14) # 下叶回勾
    return pts


def fin_polygon():
    """胸鳍：贴在肚皮下侧的一小片，让轮廓更像鲸（小尺寸下几乎看不见，不碍事）。"""
    pts = [(104, 182)]
    pts += bez((104, 182), (122, 188), (142, 190), (154, 190), steps=12)
    pts += bez((154, 190), (140, 174), (120, 166), (104, 168), steps=12)
    return pts


def scale_pts(pts, k):
    return [(x * k, y * k) for (x, y) in pts]


def draw_layer(draw, pts, k, fill):
    draw.polygon(scale_pts(pts, k), fill=fill)


def circle(draw, cx, cy, r, k, fill):
    draw.ellipse([(cx - r) * k, (cy - r) * k, (cx + r) * k, (cy + r) * k], fill=fill)


def whale_layer(size, with_spout=True, body=BRAND):
    """画一只鲸鱼（透明底），返回 RGBA 图。size 为输出边长。"""
    big = size * S
    k = big / N
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    draw_layer(d, tail_polygon(), k, body)
    draw_layer(d, body_polygon(), k, body)
    if with_spout:
        # 水柱：三点由小到大再小，往上偏左，读起来像喷出来的水
        circle(d, 74, 74, 8, k, CREAM)
        circle(d, 92, 56, 11, k, CREAM)
        circle(d, 114, 46, 7.5, k, CREAM)
    # 胸鳍与肚皮高光用深一号的橙，只在够大的尺寸下才有意义（16px 时自然糊掉）
    if size >= 64:
        draw_layer(d, fin_polygon(), k, BRAND_DEEP)
    circle(d, 94, 126, 7.5, k, INK)           # 眼睛
    circle(d, 96.5, 123.5, 2.6, k, CREAM)     # 眼里一点高光
    return img.resize((size, size), Image.LANCZOS)


def tile_layer(size, bg=TILE_DARK, body=BRAND, radius_ratio=0.22):
    """圆角方砖 + 鲸鱼。"""
    big = size * S
    tile = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(tile)
    r = int(big * radius_ratio)
    d.rounded_rectangle([0, 0, big - 1, big - 1], radius=r, fill=bg)
    # 鲸鱼按 0.78 的占比放进砖里，视觉重心略偏上
    inner = int(big * 0.78)
    w = whale_layer(inner, with_spout=True, body=body)
    ox = (big - inner) // 2
    oy = int((big - inner) * 0.56)
    tile.alpha_composite(w, (ox, oy))
    return tile.resize((size, size), Image.LANCZOS)


def svg_text(body=BRAND, tile=None):
    """矢量母版：与上面的几何一致（曲线用同一组控制点导出）。"""
    def d_of(pts):
        out = "M %.1f %.1f " % pts[0]
        for p in pts[1:]:
            out += "L %.1f %.1f " % p
        return out + "Z"
    body_pts = body_polygon()
    tail_pts = tail_polygon()
    fill = "#%02X%02X%02X" % body[:3]
    parts = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256">',
        "  <!-- DSH 管家 标志：橙红小鲸鱼（母版；位图由 icons/generate.py 生成） -->",
    ]
    if tile is not None:
        parts.append('  <rect width="256" height="256" rx="56" fill="#%02X%02X%02X"/>' % tile[:3])
    parts.append('  <path d="%s" fill="%s"/>' % (d_of(tail_pts), fill))
    parts.append('  <path d="%s" fill="%s"/>' % (d_of(body_pts), fill))
    parts.append('  <circle cx="76" cy="72" r="9" fill="#FFF0E8"/>')
    parts.append('  <circle cx="96" cy="54" r="11" fill="#FFF0E8"/>')
    parts.append('  <circle cx="118" cy="46" r="8" fill="#FFF0E8"/>')
    parts.append('  <circle cx="100" cy="128" r="8.5" fill="#201D1A"/>')
    parts.append('  <circle cx="103" cy="125" r="3" fill="#FFF0E8"/>')
    parts.append("</svg>")
    return "\n".join(parts) + "\n"


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    # 1) 矢量母版
    with open(os.path.join(here, "whale.svg"), "w", encoding="utf-8") as f:
        f.write(svg_text())
    with open(os.path.join(here, "whale-tile.svg"), "w", encoding="utf-8") as f:
        f.write(svg_text(tile=TILE_DARK))

    # 2) 应用图标（深色方砖版）
    tile = tile_layer(1024)
    tile.resize((128, 128), Image.LANCZOS).save(os.path.join(here, "128x128.png"))
    tile.resize((512, 512), Image.LANCZOS).save(os.path.join(here, "512x512.png"))
    sizes = [16, 24, 32, 48, 64, 128, 256]
    tile.save(os.path.join(here, "icon.ico"), sizes=[(s, s) for s in sizes])
    # 3) 浅色方砖备选
    tile_layer(1024, bg=TILE_LIGHT).resize((512, 512), Image.LANCZOS).save(
        os.path.join(here, "preview-light.png")
    )
    tile.resize((512, 512), Image.LANCZOS).save(os.path.join(here, "preview-dark.png"))

    # 4) 托盘（透明底、无方砖）
    tray_big = whale_layer(256, with_spout=False)
    tray_big.resize((32, 32), Image.LANCZOS).save(os.path.join(here, "tray.png"))
    tray_big.save(os.path.join(here, "tray.ico"), sizes=[(16, 16), (24, 24), (32, 32), (48, 48)])

    # 5) macOS icns（PIL 支持直接写）
    try:
        tile.resize((1024, 1024), Image.LANCZOS).save(os.path.join(here, "icon.icns"))
        print("icns ok")
    except Exception as e:
        print("icns 失败：", e)
    print("生成完成：whale.svg / whale-tile.svg / 128x128.png / 512x512.png / icon.ico / icon.icns / tray.ico / tray.png")


if __name__ == "__main__":
    main()
