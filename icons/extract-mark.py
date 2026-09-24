# -*- coding: utf-8 -*-
"""从 VI 板里把标志抠出来（品牌生产线第一步）：橙色 = D 身，D 内部被包住的区域 = 鲸鱼（奶白）。

关键改进：鲸鱼不再靠"浅色阈值"判断（那个阈值在实拍/生成图上不稳），
而是"在 D 的轮廓内部、且不是橙色的地方" —— 用洪泛填洞得到，稳得多。
"""
import os
from collections import deque
import numpy as np
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "docs", "DSH管家_品牌VI_assets",
                 "1d3c54d5-miora_edit_image-1790269100804-0-0e6ff05d549f.png")
OUT = os.path.join(ROOT, "icons", "build")
os.makedirs(OUT, exist_ok=True)

im = Image.open(SRC).convert("RGB")
a = np.asarray(im).astype(np.int16)
R, G, B = a[:, :, 0], a[:, :, 1], a[:, :, 2]
orange = (R - G > 35) & (R - B > 55) & (R > 130)
ys, xs = np.where(orange)
x0, x1 = max(0, xs.min() - 8), min(a.shape[1], xs.max() + 9)
y0, y1 = max(0, ys.min() - 8), min(a.shape[0], ys.max() + 9)
crop = im.crop((x0, y0, x1, y1))
a2 = np.asarray(crop).astype(np.int16)
R2, G2, B2 = a2[:, :, 0], a2[:, :, 1], a2[:, :, 2]
orange2 = (R2 - G2 > 35) & (R2 - B2 > 55) & (R2 > 130)
h, w = orange2.shape

# 【关键】鲸鱼的尾尖伸到 D 的轮廓之外，浅色区域和外面的背景是连通的，
# 直接填洞会把整只鲸鱼判成"外面"。所以先把橙色掩膜做几次膨胀，把尾尖那道缝糊上，
# 再去填洞 —— 这时内部才关得住，鲸鱼也就出来了。
grow = orange2.copy()
for _ in range(8):
    g = grow.copy()
    g[1:, :] |= grow[:-1, :]
    g[:-1, :] |= grow[1:, :]
    g[:, 1:] |= grow[:, :-1]
    g[:, :-1] |= grow[:, 1:]
    grow = g
print("膨胀后橙色像素:", int(grow.sum()))

# 从边界洪泛"非橙"区域 → 剩下的非橙就是被 D 包住的鲸鱼
free = ~grow
outside = np.zeros((h, w), bool)
dq = deque()
for x in range(w):
    for y in (0, h - 1):
        if free[y, x] and not outside[y, x]:
            outside[y, x] = True
            dq.append((y, x))
for y in range(h):
    for x in (0, w - 1):
        if free[y, x] and not outside[y, x]:
            outside[y, x] = True
            dq.append((y, x))
while dq:
    y, x = dq.popleft()
    for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        ny, nx = y + dy, x + dx
        if 0 <= ny < h and 0 <= nx < w and free[ny, nx] and not outside[ny, nx]:
            # 注意：这里的 free 用的是"膨胀后的橙"，判出来的内部会比真实 D 略大一点，
            # 下面再 & ~orange2 收回来即可
            outside[ny, nx] = True
            dq.append((ny, nx))

whale = (~outside) & ~orange2
print("crop:", w, "x", h, "| 橙色像素:", int(orange2.sum()), "| 鲸鱼像素:", int(whale.sum()))

ORANGE = np.array([0xF0, 0x6A, 0x3D])
CREAM = np.array([0xFA, 0xF8, 0xF5])

# 软边：橙度 / 内部浅度都转成 0..1 的 alpha，边缘才不会锯齿
orange_score = np.clip((R2 - G2 - 12) / 45.0, 0, 1) * np.clip((R2 - B2 - 25) / 60.0, 0, 1)
orange_alpha = (orange_score * 255).astype(np.uint8)
# 鲸鱼：内部区域里"越浅越实"，深色描边处自然收窄
lum = (R2 + G2 + B2) / 3.0
whale_alpha = (np.clip((lum - 150) / 60.0, 0, 1) * whale * 255).astype(np.uint8)

out = np.zeros((h, w, 4), np.uint8)
out[:, :, 0:3] = ORANGE
out[:, :, 3] = orange_alpha
m = whale_alpha > 40
out[:, :, 0:3][m] = CREAM
out[:, :, 3] = np.maximum(orange_alpha, whale_alpha)

Image.fromarray(out, "RGBA").save(os.path.join(OUT, "mark-raw.png"))
Image.fromarray(out, "RGBA").resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, "mark-512.png"))
print("已输出 mark-raw.png / mark-512.png（下一步：python icons/build-icons.py）")
