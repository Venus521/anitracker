"""生成追迹手机壳的启动图标 —— 纯 PIL 手画，不用 AI 生成（会跑色）。

产出两套：
  · 自适应图标（Android 8+）：背景层 + 前景层，由各厂商遮罩成圆形/方圆形，不会被切坏；
  · 传统 PNG（Android 5-7）：预先切成方圆形（squircle）的 48/72/96/144/192 五档。

设计（用户指令「图标要可爱」）：奶白底 + 暖棕描边的奶黄小猫正脸，倒三角鼻子＝转了向的播放键。
用法：python mobile-shell/make-icon.py
"""
import math
import os

from PIL import Image, ImageDraw

SRC = os.path.dirname(os.path.abspath(__file__))
RES = os.path.join(SRC, 'res')

SS = 4                      # 超采样倍数，抗锯齿
FULL = 108 * SS             # 自适应图标标准画布（108dp）
CREAM_TOP = (255, 248, 236)  # 奶白上沿
CREAM_BOT = (248, 235, 213)  # 奶白下沿，稍暖一点
GOLD = (224, 172, 94)        # 亮黄铜（比 UI 的 --accent 更跳，走可爱路线）
GOLD_DK = (198, 146, 72)     # 内耳/阴影
INK = (78, 62, 47)           # 暖棕描边——纯黑描边太硬，贴纸感就没了
ROSE = (241, 168, 164)       # 腮红与内耳的粉


def canvas(size, color):
    im = Image.new('RGBA', (size, size), color + (255,))
    return im, ImageDraw.Draw(im)


def vertical_gradient(size, top, bottom):
    im = Image.new('RGBA', (size, size))
    px = im.load()
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)) + (255,)
        for x in range(size):
            px[x, y] = c
    return im


def draw_background():
    return vertical_gradient(FULL, CREAM_TOP, CREAM_BOT)


def dp(v):
    return v * SS


def draw_foreground():
    """一只奶黄小猫的正脸：三角鼻子＝播放键，追番和可爱就一个形状解决。

    所有五官都压在 108dp 画布的 36dp 安全圆内——圆形启动器会裁掉圈外部分，
    耳朵尖或下巴一出界就被削平，脸立刻变形。
    """
    im = Image.new('RGBA', (FULL, FULL), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    OL = int(dp(3.2))                    # 描边粗（PIL 12 要求 width 是整数）

    # 头：60×52dp 圆角方块，圆角 22dp——越圆越软，且角尖刚好落在 36dp 安全圆内不被裁
    # （试过加猫耳：耳尖要超出安全圆就会被圆形启动器裁掉，收进来又被头的圆角盖成两点碎屑，
    #   读起来像瑕疵，所以干脆不要耳朵，团子脸本身就够萌）
    head = [dp(24), dp(32), dp(84), dp(84)]
    d.rounded_rectangle(head, radius=dp(22), fill=GOLD + (255,),
                        outline=INK + (255,), width=OL)

    # 眼睛：竖椭圆比正圆更「萌」，高光点在左上
    for cx in (42, 66):
        d.ellipse([dp(cx) - dp(4), dp(48), dp(cx) + dp(4), dp(61)], fill=INK + (255,))
        d.ellipse([dp(cx) - dp(1.8), dp(50), dp(cx) + dp(0.4), dp(53)],
                  fill=CREAM_TOP + (255,))

    # 腮红
    for cx in (33, 75):
        d.ellipse([dp(cx) - dp(5), dp(60), dp(cx) + dp(5), dp(66)], fill=ROSE + (255,))

    # 鼻子＝倒三角＝转了个方向的播放键
    nose = [(dp(48.5), dp(64)), (dp(59.5), dp(64)), (dp(54), dp(71.5))]
    d.polygon(rounded_polygon(nose, dp(2.2)), fill=GOLD_DK + (255,),
              outline=INK + (255,), width=int(dp(2.4)))

    # 「ω」嘴：两道小弧
    d.arc([dp(46), dp(69), dp(54), dp(76.5)], start=15, end=165, fill=INK + (255,),
          width=int(dp(2.4)))
    d.arc([dp(54), dp(69), dp(62), dp(76.5)], start=15, end=165, fill=INK + (255,),
          width=int(dp(2.4)))
    return im


def rounded_polygon(points, radius, ss_steps=10):
    """把多边形每个角切成正圆角：沿两边取切点，再用圆弧补角。
       （直接在顶点叠圆会把角凸成「球头」，不是圆角。）"""
    n = len(points)
    out = []
    for i in range(n):
        p = points[i]
        a, b = points[i - 1], points[(i + 1) % n]
        va = (a[0] - p[0], a[1] - p[1])
        vb = (b[0] - p[0], b[1] - p[1])
        la, lb = math.hypot(*va), math.hypot(*vb)
        ua, ub = (va[0] / la, va[1] / la), (vb[0] / lb, vb[1] / lb)
        ang = math.acos(max(-1.0, min(1.0, ua[0] * ub[0] + ua[1] * ub[1])))
        r = min(radius, la / 2.5, lb / 2.5)
        t = r / math.tan(ang / 2.0)                 # 切点距顶点
        d = r / math.sin(ang / 2.0)                 # 圆心距顶点
        bis = ((ua[0] + ub[0]) / 2.0, (ua[1] + ub[1]) / 2.0)
        bl = math.hypot(*bis)
        cx, cy = p[0] + bis[0] / bl * d, p[1] + bis[1] / bl * d
        ta = (p[0] + ua[0] * t, p[1] + ua[1] * t)
        tb = (p[0] + ub[0] * t, p[1] + ub[1] * t)
        a1, a2 = math.degrees(math.atan2(ta[1] - cy, ta[0] - cx)), \
                 math.degrees(math.atan2(tb[1] - cy, tb[0] - cx))
        delta = (a2 - a1) % 360.0
        if delta > 180.0:
            a1, a2, delta = a2, a1, 360.0 - delta
        out.append(ta)
        for s in range(1, ss_steps):
            th = math.radians(a1 + delta * s / ss_steps)
            out.append((cx + r * math.cos(th), cy + r * math.sin(th)))
        out.append(tb)
    return out


def squircle(size, radius_ratio=0.225):
    """Android 高版本默认遮罩是方圆形，传统图标照这个比例切，摆一起才不打架。"""
    r = int(size * radius_ratio)
    m = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=255)
    return m


def legacy_sizes(bg, fg):
    """mipmap 五档：把背景+前景叠好后按各档尺寸重绘，再切方圆形。"""
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

    # 验收预览：把遮罩成圆形/方圆形的效果、以及桌面真实尺寸一起排出来看
    comp = Image.alpha_composite(bg.convert('RGBA'), fg.convert('RGBA'))
    sheet = Image.new('RGBA', (660, 240), (150, 158, 172, 255))
    # 左半深壁纸、右半浅壁纸：奶白图标只在其中一边显眼，两边都要看到才敢定稿
    sheet.paste(Image.new('RGBA', (210, 240), (246, 243, 238, 255)), (450, 0))
    sd = ImageDraw.Draw(sheet)

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
    # 桌面真实大小：48/72 各档，挨着摆看小尺寸下还认不认得出
    y = 40
    for px in (72, 48):
        tile = masked(px, 'circle')
        sheet.paste(tile, (x + 10, y), tile)
        y += px + 24
    sheet.save(os.path.join(SRC, 'icon-preview.png'))
    print('  icon-preview.png（圆形/方圆形遮罩 + 72/48 真实尺寸）')


if __name__ == '__main__':
    main()
