# -*- coding: utf-8 -*-
"""核对 exe 内嵌 PNG 图标与 icon.ico / icons 目录是否为同一套图（像素级）"""
import hashlib
import io
import os
import re

from PIL import Image

BASE = r"G:\DSH\DSH-PluginUpdater"
EXE_DIR = os.path.join(BASE, "src-tauri", "target", "release")
ICO = os.path.join(BASE, "src-tauri", "icons", "icon.ico")
ICONS_DIR = os.path.join(BASE, "src-tauri", "icons")


def find_exes():
    exes = []
    for root, _dirs, files in os.walk(EXE_DIR):
        for f in files:
            if f.lower().endswith(".exe"):
                p = os.path.join(root, f)
                exes.append((p, os.path.getsize(p), os.path.getmtime(p)))
    return sorted(exes, key=lambda x: -x[1])


def extract_pngs(data: bytes):
    """按 PNG chunk 结构完整提取 exe 内嵌的 PNG"""
    sig = b"\x89PNG\r\n\x1a\n"
    out = []
    idx = 0
    while True:
        idx = data.find(sig, idx)
        if idx < 0:
            break
        pos = idx + 8
        ok = False
        while pos + 8 <= len(data):
            length = int.from_bytes(data[pos : pos + 4], "big")
            ctype = data[pos + 4 : pos + 8]
            pos += 8 + length + 4  # len + type + data + crc
            if ctype == b"IEND":
                ok = True
                break
        if ok:
            out.append(data[idx:pos])
        idx += 8
    return out


def pixel_hash(img: Image.Image) -> str:
    im = img.convert("RGBA")
    return hashlib.sha256(im.tobytes()).hexdigest()[:16]


def ico_frames(path):
    im = Image.open(path)
    frames = {}
    # ico 多尺寸：逐帧
    for i in range(getattr(im, "n_frames", 1)):
        im.seek(i)
        frames[im.size] = pixel_hash(im)
    return frames


def main():
    exes = find_exes()
    if not exes:
        print("!! 未找到 exe")
        return
    exe_path, exe_size, exe_mtime = exes[0]
    import datetime

    print(f"exe: {exe_path}")
    print(f"  大小 {exe_size}, 修改时间 {datetime.datetime.fromtimestamp(exe_mtime)}")
    with open(exe_path, "rb") as f:
        data = f.read()

    exe_pngs = extract_pngs(data)
    print(f"  exe 内提取到 {len(exe_pngs)} 张 PNG")
    exe_hashes = {}
    for png in exe_pngs:
        try:
            img = Image.open(io.BytesIO(png))
            h = pixel_hash(img)
            exe_hashes.setdefault(img.size, h)
            print(f"    {img.size[0]}x{img.size[1]}  pixel={h}  bytes={len(png)}")
        except Exception as e:
            print(f"    解析失败: {e}")

    print()
    print(f"icon.ico: {ICO}")
    ico = ico_frames(ICO)
    for size, h in sorted(ico.items()):
        mark = ""
        if size in exe_hashes:
            mark = "  <== 与 exe 内嵌一致" if exe_hashes[size] == h else "  <<!= 与 exe 不一致"
        print(f"    {size[0]}x{size[1]}  pixel={h}{mark}")

    print()
    print("icons/ 目录 PNG 像素比对：")
    for f in sorted(os.listdir(ICONS_DIR)):
        if not f.endswith(".png"):
            continue
        img = Image.open(os.path.join(ICONS_DIR, f))
        h = pixel_hash(img)
        mark = ""
        if img.size in exe_hashes:
            mark = "  <== 与 exe 内嵌一致" if exe_hashes[img.size] == h else "  <<!= 不一致"
        print(f"    {f:20s} {img.size[0]}x{img.size[1]} pixel={h}{mark}")

    # 结论
    matched = sum(1 for s in ico if s in exe_hashes and exe_hashes[s] == ico[s])
    print()
    print(f"结论: ico {len(ico)} 个尺寸中 {matched} 个与 exe 内嵌像素一致")
    if matched >= max(1, len(ico) // 2):
        print(">>> 新图标已成功嵌入 exe")
    else:
        print(">>> exe 内嵌的不是新图标，需要重新打包")


main()
