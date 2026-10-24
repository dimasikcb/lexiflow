"""
LexiFlow — генератор иконок приложения.

Рисует PNG-иконки без внешних библиотек (только стандартный zlib/struct):
скруглённый квадрат с градиентом и двумя карточками-«словами».

Запуск:
    python tools/generate_icons.py
"""

import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")

VIOLET = (109, 74, 255)
TEAL = (46, 197, 182)
DEEP = (58, 34, 170)          # цвет «текста» на карточке
WHITE = (255, 255, 255)


def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


def sd_round_rect(px, py, cx, cy, hw, hh, r):
    """Signed distance до скруглённого прямоугольника."""
    dx = abs(px - cx) - (hw - r)
    dy = abs(py - cy) - (hh - r)
    ax, ay = max(dx, 0.0), max(dy, 0.0)
    return math.hypot(ax, ay) + min(max(dx, dy), 0.0) - r


def rotate(px, py, cx, cy, deg):
    a = math.radians(deg)
    ca, sa = math.cos(a), math.sin(a)
    dx, dy = px - cx, py - cy
    return cx + dx * ca - dy * sa, cy + dx * sa + dy * ca


def over(dst, src):
    """Alpha-композиция src поверх dst."""
    sa = src[3]
    if sa <= 0:
        return dst
    da = dst[3]
    out_a = sa + da * (1 - sa)
    if out_a <= 0:
        return (0, 0, 0, 0)
    out = []
    for i in range(3):
        out.append((src[i] * sa + dst[i] * da * (1 - sa)) / out_a)
    return (out[0], out[1], out[2], out_a)


def make_icon(size, path, maskable=False):
    S = float(size)
    aa = max(0.8, S / 300.0)
    scale = 0.84 if maskable else 1.0

    # геометрия карточек (в долях от S), центр композиции
    cx, cy = S / 2, S / 2

    def pt(fx, fy):
        """Точка в долях от центра с учётом масштаба контента."""
        return cx + (fx - 0.5) * S * scale, cy + (fy - 0.5) * S * scale

    back = dict(center=pt(0.465, 0.395), hw=0.215 * S * scale, hh=0.150 * S * scale, r=0.045 * S * scale, angle=-12)
    front = dict(center=pt(0.535, 0.585), hw=0.230 * S * scale, hh=0.162 * S * scale, r=0.050 * S * scale, angle=-12)
    bars = [
        dict(center=pt(0.560, 0.545), hw=0.128 * S * scale, hh=0.018 * S * scale, r=0.018 * S * scale),
        dict(center=pt(0.545, 0.600), hw=0.100 * S * scale, hh=0.016 * S * scale, r=0.016 * S * scale),
        dict(center=pt(0.520, 0.648), hw=0.072 * S * scale, hh=0.016 * S * scale, r=0.016 * S * scale),
    ]

    bg_r = 0.0 if maskable else 0.222 * S
    rows = []
    for y in range(size):
        row = bytearray()
        row.append(0)  # filter type
        py = y + 0.5
        for x in range(size):
            px = x + 0.5

            # фон: градиент по диагонали
            t = clamp((px + py) / (2 * S), 0.0, 1.0)
            t = t * t * (3 - 2 * t)  # smoothstep
            bg = (
                VIOLET[0] + (TEAL[0] - VIOLET[0]) * t,
                VIOLET[1] + (TEAL[1] - VIOLET[1]) * t,
                VIOLET[2] + (TEAL[2] - VIOLET[2]) * t,
            )

            # фон-подложка
            if maskable:
                cov_bg = 1.0
            else:
                d = sd_round_rect(px, py, S / 2, S / 2, S / 2, S / 2, bg_r)
                cov_bg = clamp(0.5 - d / aa, 0.0, 1.0)

            if cov_bg <= 0:
                row += bytes((0, 0, 0, 0))
                continue

            px_out = (bg[0], bg[1], bg[2], cov_bg)

            # задняя карточка
            rx, ry = rotate(px, py, back["center"][0], back["center"][1], back["angle"])
            d = sd_round_rect(rx, ry, back["center"][0], back["center"][1], back["hw"], back["hh"], back["r"])
            cov = clamp(0.5 - d / aa, 0.0, 1.0)
            if cov > 0:
                px_out = over(px_out, (WHITE[0], WHITE[1], WHITE[2], 0.34 * cov))

            # передняя карточка
            rx, ry = rotate(px, py, front["center"][0], front["center"][1], front["angle"])
            d = sd_round_rect(rx, ry, front["center"][0], front["center"][1], front["hw"], front["hh"], front["r"])
            cov = clamp(0.5 - d / aa, 0.0, 1.0)
            if cov > 0:
                px_out = over(px_out, (WHITE[0], WHITE[1], WHITE[2], 0.97 * cov))

            # «текст» на передней карточке
            for b in bars:
                rx, ry = rotate(px, py, front["center"][0], front["center"][1], front["angle"])
                d = sd_round_rect(rx, ry, b["center"][0], b["center"][1], b["hw"], b["hh"], b["r"])
                cov = clamp(0.5 - d / aa, 0.0, 1.0)
                if cov > 0:
                    px_out = over(px_out, (DEEP[0], DEEP[1], DEEP[2], 0.9 * cov))

            a = px_out[3]
            row += bytes((
                int(clamp(px_out[0], 0, 255)),
                int(clamp(px_out[1], 0, 255)),
                int(clamp(px_out[2], 0, 255)),
                int(clamp(a * 255, 0, 255)),
            ))
        rows.append(bytes(row))

    raw = b"".join(rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data +
                struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))

    with open(path, "wb") as f:
        f.write(png)
    return len(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    jobs = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
        ("apple-touch-icon.png", 180, True),
    ]
    for name, size, maskable in jobs:
        path = os.path.join(OUT_DIR, name)
        written = make_icon(size, path, maskable)
        print("%-24s %4dx%-4d %7.1f КБ" % (name, size, size, written / 1024))


if __name__ == "__main__":
    main()
