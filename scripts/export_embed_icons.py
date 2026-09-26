# -*- coding: utf-8 -*-
"""把 exe 内嵌图标导出为图片，和 icons 目录图标并排对比"""
import io
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from verify_icon_embed import extract_pngs, find_exes

from PIL import Image

BASE = r"G:\DSH\DSH-PluginUpdater"
OUT = os.path.join(BASE, "scripts", "icon-export")
os.makedirs(OUT, exist_ok=True)

exe_path = find_exes()[0][0]
print("exe:", exe_path)
with open(exe_path, "rb") as f:
    data = f.read()

for i, png in enumerate(extract_pngs(data)):
    img = Image.open(io.BytesIO(png))
    out_path = os.path.join(OUT, f"exe-embed-{img.size[0]}x{img.size[1]}.png")
    img.save(out_path)
    print("导出:", out_path)

# 也导出 icons 目录的 256 和 ico 的 256
for src, name in [
    (os.path.join(BASE, "src-tauri", "icons", "icon-256.png"), "icons-icon-256.png"),
    (os.path.join(BASE, "src-tauri", "icons", "128x128@2x.png"), "icons-128@2x.png"),
]:
    img = Image.open(src)
    img.save(os.path.join(OUT, name))
    print("导出:", name, img.size)

# ico 的 256 帧
ico = Image.open(os.path.join(BASE, "src-tauri", "icons", "icon.ico"))
ico.seek(ico.n_frames - 1)  # 通常最后一帧是最大
ico.save(os.path.join(OUT, "ico-last-frame.png"))
print("导出: ico-last-frame.png", ico.size, "帧数:", ico.n_frames)
