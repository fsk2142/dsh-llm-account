"""画额度卡片的几种候选样式，用于视觉对齐（头像/状态卡预览）。

目的：用户说当前实现「四不像」。先在图上看清楚「圆角矩形 + 边框按比例消失」
应该长什么样，避免继续盲改。

几何与 SVG 的 stroke-dashoffset 等价：沿圆角矩形周长取样，只画前
`fraction` 比例的那一段。
"""
import math
from PIL import Image, ImageDraw, ImageFont

FONT_PATH = "C:/Windows/Fonts/msyh.ttc"
SCALE = 2  # 画完再缩，边缘更干净

INK = (32, 33, 36)
MUTED = (120, 124, 132)
TRACK = (214, 217, 222)
GREEN = (46, 158, 91)
YELLOW = (200, 145, 20)
RED = (198, 66, 66)
PANEL = (250, 250, 251)


def font(size, bold=False):
    try:
        return ImageFont.truetype(FONT_PATH, int(size * SCALE), index=0)
    except OSError:
        return ImageFont.load_default()


def rounded_rect_outline(w, h, r, x0=0.0, y0=0.0, steps_per_arc=24):
    """圆角矩形描边路径的采样点（从**上边中点**起，顺时针一圈）。

    与 SVG 的 dasharray 语义一致：按累计长度切分，前 fraction 就是「剩余」。
    """
    r = min(r, w / 2, h / 2)
    cx = x0 + w / 2
    start = (cx, y0)
    pts = [start]

    def line(to):
        px, py = pts[-1]
        pts.append((to[0], to[1]))

    def arc(center, start_angle, end_angle):
        cxx, cyy = center
        # 顺时针：角度递减
        n = steps_per_arc
        for i in range(1, n + 1):
            a = math.radians(start_angle + (end_angle - start_angle) * i / n)
            pts.append((cxx + r * math.cos(a), cyy + r * math.sin(a)))

    # 上边右半
    line((x0 + w - r, y0))
    # 右上角
    arc((x0 + w - r, y0 + r), -90, 0)
    # 右边
    line((x0 + w, y0 + h - r))
    # 右下角
    arc((x0 + w - r, y0 + h - r), 0, 90)
    # 下边
    line((x0 + r, y0 + h))
    # 左下角
    arc((x0 + r, y0 + h - r), 90, 180)
    # 左边
    line((x0, y0 + r))
    # 左上角
    arc((x0 + r, y0 + r), 180, 270)
    # 上边左半，回到起点
    line(start)
    return pts


def draw_partial_outline(draw, box, radius, fraction, color, width):
    """画「剩余比例」那段描边。fraction=None 表示不画（读不到 / 不限）。"""
    if fraction is None:
        return
    x0, y0, x1, y1 = box
    pts = rounded_rect_outline(x1 - x0, y1 - y0, radius, x0, y0)
    # 按长度取前 fraction
    seg = []
    total = 0.0
    lens = [0.0]
    for i in range(1, len(pts)):
        total += math.dist(pts[i - 1], pts[i])
        lens.append(total)
    target = total * max(0.0, min(1.0, fraction))
    seg = [pts[0]]
    for i in range(1, len(pts)):
        if lens[i] <= target:
            seg.append(pts[i])
        else:
            # 截断到精确长度
            prev_len = lens[i - 1]
            need = target - prev_len
            seg_len = lens[i] - prev_len
            t = 0.0 if seg_len == 0 else need / seg_len
            ax, ay = pts[i - 1]
            bx, by = pts[i]
            seg.append((ax + (bx - ax) * t, ay + (by - ay) * t))
            break
    if len(seg) >= 2:
        draw.line(seg, fill=color, width=int(width * SCALE), joint="curve")


def draw_card(img, draw, ox, oy, *, w, h, radius, border, label, value, reset,
              fraction, label_size, value_size, reset_size, radius_hint=None):
    """画一张卡片：档位名在上，矩形内两行文字，边框按比例消失。"""
    ox, oy = ox * SCALE, oy * SCALE
    w, h = w * SCALE, h * SCALE
    radius, border = radius * SCALE, border * SCALE

    # 档位名（居中于矩形）
    lab_font = font(label_size)
    tw = draw.textlength(label, font=lab_font)
    draw.text((ox + (w - tw) / 2, oy), label, font=lab_font, fill=MUTED)
    label_h = label_size * SCALE + 6 * SCALE

    box = (ox, oy + label_h, ox + w, oy + label_h + h)
    # 卡片底
    draw.rounded_rectangle(box, radius=radius, fill=PANEL)
    # 底框（常量参照）
    draw_partial_outline(draw, box, radius, 1.0, TRACK, border)
    # 进度框
    color = GREEN if (fraction is None or fraction > 0.5) else (YELLOW if fraction > 0.2 else RED)
    draw_partial_outline(draw, box, radius, fraction, color, border)

    # 两行文字
    vf, rf = font(value_size, True), font(reset_size)
    centre_x = box[0] + w / 2
    vh = value_size * SCALE
    rh = reset_size * SCALE
    gap = 1 * SCALE
    block = vh + gap + rh
    ty = box[1] + (h - block) / 2
    vw = draw.textlength(value, font=vf)
    draw.text((centre_x - vw / 2, ty), value, font=vf, fill=INK)
    rw = draw.textlength(reset, font=rf)
    draw.text((centre_x - rw / 2, ty + vh + gap), reset, font=rf, fill=MUTED)


def main():
    CW, CH = 1180, 760
    img = Image.new("RGB", (CW * SCALE, CH * SCALE), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    title = font(17, True)
    small = font(11)
    draw.text((24 * SCALE, 18 * SCALE), "额度卡片候选样式（左边=满额，右边=用掉一半）", font=title, fill=INK)
    draw.text((24 * SCALE, 44 * SCALE), "灰框是「总量」参照；彩色那段是「剩余」，用掉多少就缺多少", font=small, fill=MUTED)

    # A 当前实现
    y = 78
    draw.text((24 * SCALE, y * SCALE), "A  当前实现：76×44，边框 2px，圆角 9，字号 9/9", font=font(12, True), fill=INK)
    draw_card(img, draw, 24, y + 22, w=76, h=44, radius=9, border=2,
              label="5 小时", value="96%", reset="10-19 20:00",
              fraction=0.96, label_size=11, value_size=9, reset_size=9)
    draw_card(img, draw, 150, y + 22, w=76, h=44, radius=9, border=2,
              label="5 小时", value="50%", reset="10-19 20:00",
              fraction=0.5, label_size=11, value_size=9, reset_size=9)

    # B 更大的圆角矩形
    y = 200
    draw.text((24 * SCALE, y * SCALE), "B  更大更粗：96×56，边框 3px，圆角 12，字数大一点 13/10", font=font(12, True), fill=INK)
    draw_card(img, draw, 24, y + 22, w=96, h=56, radius=12, border=3,
              label="5 小时", value="96%", reset="10-19 20:00",
              fraction=0.96, label_size=12, value_size=13, reset_size=10)
    draw_card(img, draw, 190, y + 22, w=96, h=56, radius=12, border=3,
              label="5 小时", value="50%", reset="10-19 20:00",
              fraction=0.5, label_size=12, value_size=13, reset_size=10)

    # C 接近正方形（最接近圆环的观感）
    y = 336
    draw.text((24 * SCALE, y * SCALE), "C  接近正方形：80×72，边框 3px，圆角 16，百分比大 15/9", font=font(12, True), fill=INK)
    draw_card(img, draw, 24, y + 22, w=80, h=72, radius=16, border=3,
              label="5 小时", value="96%", reset="10-19 20:00",
              fraction=0.96, label_size=12, value_size=15, reset_size=9)
    draw_card(img, draw, 170, y + 22, w=80, h=72, radius=16, border=3,
              label="5 小时", value="50%", reset="10-19 20:00",
              fraction=0.5, label_size=12, value_size=15, reset_size=9)

    # D 两种状态：低额度 + 读不到
    y = 500
    draw.text((24 * SCALE, y * SCALE), "D  低额度（15%）与读不到（不画彩框）", font=font(12, True), fill=INK)
    draw_card(img, draw, 24, y + 22, w=80, h=72, radius=16, border=3,
              label="5 小时", value="15%", reset="10-19 20:00",
              fraction=0.15, label_size=12, value_size=15, reset_size=9)
    draw_card(img, draw, 170, y + 22, w=80, h=72, radius=16, border=3,
              label="5 小时", value="—", reset="未知",
              fraction=None, label_size=12, value_size=15, reset_size=9)

    out = img.resize((CW, CH), Image.LANCZOS)
    out.save("C:/Work/dsh-plug-in/dsh-llm-account/.quota-card-preview.png")
    print("saved")


if __name__ == "__main__":
    main()
