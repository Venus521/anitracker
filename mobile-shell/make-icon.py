"""生成追迹手机壳的启动图标 —— 纯 PIL 手画，不用 AI 生成（会跑色）。

产出两套：
  · 自适应图标（Android 8+）：背景层 + 前景层，由各厂商遮罩成圆形/方圆形，不会被切坏；
  · 传统 PNG（Android 5-7）：预先切成方圆形（squircle）的 48/72/96/144/192 五档。

设计（用户指令「图标要可爱」+ v2.40.0「越精美越好」重画）：
  奶白渐变底 + 蜜金圆脸猫 —— 头改成**正圆**：圆形启动器遮罩零裁切（旧版圆角方头四角
  超出安全圈被削平）；ω 嘴改贝塞尔采样曲线（旧版 PIL arc 拼出来发糊）；配色对齐品牌
  （纸底 #fff8ec→#f4e9d6、蜜金 #e2ad5c、暖棕描边 #4e3e2f）。
用法：python mobile-shell/make-icon.py
"""
import os

from PIL import Image, ImageDraw

SRC = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(SRC, 'res')

SS = 6                      # 超采样倍数（v2.40.0 从 4 提到 6，小尺寸边缘更润）
FULL = 108 * SS             # 自适应图标标准画布（108dp）
CREAM_TOP = (255, 248, 236)  # 纸底上沿（同 Web 图标）
CREAM_BOT = (244, 233, 214)  # 纸底下沿
GOLD = (226, 173, 92)        # 蜜金（比 UI accent 亮一档，桌面缩略图才跳得出来）
GOLD_DK = (196, 142, 66)     # 鼻子/阴影
INK = (78, 62, 47)           # 暖棕描边
ROSE = (243, 176, 170)       # 腮红
CREAM_HI = (255, 250, 242)   # 眼睛高光


def vertical_gradient(size, top, bottom):
    im = Image.new('RGBA', (size, size))
    px = im.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = c
    return im


def dp(v):
    return round(v * SS)


def bezier(p0, p1, p2, n=48):
    """二阶贝塞尔采样：ω 嘴和一切曲线都用它，PIL 自带 arc 拼不出平滑圆角。"""
    return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * p1[0] + t * t * p2[0],
             (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * p1[1] + t * t * p2[1])
            for t in (i / n for i in range(n + 1))]


def draw_background():
    return vertical_gradient(FULL, CREAM_TOP, CREAM_BOT)


def draw_foreground():
    """蜜金圆脸猫：头是正圆（r=29.5dp，圆心略沉），圆遮罩零裁切；五官全部落在安全圆内。"""
    im = Image.new('RGBA', (FULL, FULL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    OL = dp(3.0)
    CX, CY = 54.0, 57.0
    R = 29.5
    head_box = [dp(CX - R), dp(CY - R), dp(CX + R), dp(CY + R)]
    d.ellipse(head_box, fill=GOLD + (255,), outline=INK + (255,), width=OL)

    # 耳朵内芯的两撇腮红代替耳朵（耳朵出安全圆必被裁，v2.14 就试过）：先腮红
    for cx in (33.5, 74.5):
        d.ellipse([dp(cx - 5.2), dp(CY + 3.5), dp(cx + 5.2), dp(CY + 9.5)], fill=ROSE + (235,))

    # 眼睛：竖椭圆 + 左上高光（高光偏左上，视线方向一致才「活」）
    for cx in (43.0, 65.0):
        d.ellipse([dp(cx - 4.2), dp(CY - 8.5), dp(cx + 4.2), dp(CY + 4.5)], fill=INK + (255,))
        d.ellipse([dp(cx - 2.4), dp(CY - 6.8), dp(cx + 0.6), dp(CY - 3.8)], fill=CREAM_HI + (255,))

    # 鼻子＝倒三角（转了向的播放键），圆角采样
    nose = [(49.2, CY + 3.2), (58.8, CY + 3.2), (54.0, CY + 9.6)]
    d.polygon([tuple(map(dp, p)) for p in bezier_corners(nose, 2.0)], fill=GOLD_DK + (255,),
              outline=INK + (255,), width=dp(2.0))

    # ω 嘴：两段对称贝塞尔，从鼻底垂到两侧，末端微微上翘
    mouth_l = bezier((54.0, CY + 9.8), (51.5, CY + 14.5), (46.5, CY + 13.2))
    mouth_r = bezier((54.0, CY + 9.8), (56.5, CY + 14.5), (61.5, CY + 13.2))
    d.line([tuple(map(dp, p)) for p in mouth_l], fill=INK + (255,), width=dp(2.2), joint='curve')
    d.line([tuple(map(dp, p)) for p in mouth_r], fill=INK + (255,), width=dp(2.2), joint='curve')
    for end in (mouth_l[-1], mouth_r[-1]):   # 线帽圆头
        d.ellipse([dp(end[0]) - dp(1.1), dp(end[1]) - dp(1.1),
                   dp(end[0]) + dp(1.1), dp(end[1]) + dp(1.1)], fill=INK + (255,))
    return im


def bezier_corners(pts, r):
    """三点三角形的圆角版（鼻子用）：每个角用贝塞尔切角。"""
    out = []
    n = len(pts)
    for i in range(n):
        p, a, b = pts[i], pts[i - 1], pts[(i + 1) % n]
        for t in (0.62, 0.8, 0.9):
            out.append((p[0] + (a[0] - p[0]) * t, p[1] + (a[1] - p[1]) * t))
        mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
        out.append(bezier((p[0] + (a[0] - p[0]) * 0.9, p[1] + (a[1] - p[1]) * 0.9),
                          (p[0] + (mid[0] - p[0]) * 0.95, p[1] + (mid[1] - p[1]) * 0.95),
                          (p[0] + (b[0] - p[0]) * 0.9, p[1] + (b[1] - p[1]) * 0.9), 10)[3])
        for t in (0.9, 0.8, 0.62):
            out.append((p[0] + (b[0] - p[0]) * t, p[1] + (b[1] - p[1]) * t))
    return out


def squircle(size, radius_ratio=0.225):
    r = int(size * radius_ratio)
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def legacy_sizes(bg, fg):
    tiers = {'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192}
    full = Image.alpha_composite(bg.convert('RGBA'), fg.convert('RGBA'))
    for name, px in tiers.items():
        im = full.resize((px * SS, px * SS), Image.LANCZOS)
        out = Image.new('RGBA', (px * SS, px * SS), (0, 0, 0, 0))
        out.paste(im, (0, 0), squircle(px * SS))
        d = os.path.join(RES, 'mipmap-' + name)
        os.makedirs(d, exist_ok=True)
        out.resize((px, px), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'), optimize=True)
        print('  mipmap-%-7s %dp' % (name, px))


def main():
    for sub in ('drawable-nodpi', 'mipmap-anydpi-v26'):
        os.makedirs(os.path.join(RES, sub), exist_ok=True)

    bg = draw_background()
    fg = draw_foreground()
    bg.save(os.path.join(RES, 'drawable-nodpi', 'ic_launcher_bg.png'), optimize=True)
    fg.save(os.path.join(RES, 'drawable-nodpi', 'ic_launcher_fg.png'), optimize=True)
    print('  drawable-nodpi/ic_launcher_bg.png + ic_launcher_fg.png (%dp)' % FULL)

    with open(os.path.join(RES, 'mipmap-anydpi-v26', 'ic_launcher.xml'), 'w', encoding='utf-8') as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@drawable/ic_launcher_bg" />\n'
                '    <foreground android:drawable="@drawable/ic_launcher_fg" />\n'
                '</adaptive-icon>\n')
    print('  mipmap-anydpi-v26/ic_launcher.xml')

    legacy_sizes(bg, fg)

    # 验收预览：圆形/方圆形遮罩 + 桌面真实尺寸，左深右浅壁纸
    from PIL import ImageDraw as _ID
    comp = Image.alpha_composite(bg.convert('RGBA'), fg.convert('RGBA'))
    sheet = Image.new('RGBA', (660, 240), (150, 158, 172, 255))
    sheet.paste(Image.new('RGBA', (210, 240), (246, 243, 238, 255)), (450, 0))
    sd = _ID.Draw(sheet)

    def masked(size, kind):
        im = comp.resize((size, size), Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        m = Image.new('L', (size, size), 0)
        md = ImageDraw.Draw(m)
        if kind == 'circle':
            md.ellipse([0, 0, size - 1, size - 1], fill=255)
        elif kind == 'round':
            md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.18), fill=255)
        else:
            md.rectangle([0, 0, size - 1, size - 1], fill=255)
        out.paste(im, (0, 0), m)
        return out

    x = 20
    for kind, size in (('circle', 200), ('round', 200)):
        tile = masked(size, kind)
        sheet.paste(tile, (x, 20), tile)
        x += size + 20
    y = 40
    for px in (72, 48):
        tile = masked(px, 'circle')
        sheet.paste(tile, (x + 10, y), tile)
        y += px + 24
    sheet.save(os.path.join(SRC, 'icon-preview.png'))
    print('  icon-preview.png（圆形/方圆形遮罩 + 72/48 真实尺寸）')


if __name__ == '__main__':
    main()
