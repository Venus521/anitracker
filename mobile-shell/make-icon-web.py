# -*- coding: utf-8 -*-
"""生成追迹 Web/PWA 图标（favicon.ico / tracker-icon-512.png / maskable）。

设计语言 = 「纸间编辑部」印刷感（OB 设计偏好）：
  暖纸底竖向渐变 + 黄铜双细线框（票券感）+ 大号衬线/楷体「追」+ 黄铜播放三角小印章。
矢量 SVG 用无头 Chrome 栅格化（颜色精确、曲线平滑，配色写死十六进制不走 AI 生成）。
产物：
  ../tracker-icon-512.png          常规图标（any）
  ../tracker-icon-maskable-512.png 安卓自适应安全区版（maskable，框收进安全圆）
  ../favicon.ico                   16/32/48 三档
  icon-preview-web.png             遮罩预览 + 字体对比（Georgia衬线 vs 楷体）
用法：python mobile-shell/make-icon-web.py
"""
import os
import subprocess
import tempfile

from PIL import Image

SRC = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(SRC)
CHROME = os.environ.get('AT_CHROME', r'C:\Program Files\Google\Chrome\Application\chrome.exe')

PAPER_TOP = '#fff8ec'
PAPER_BOT = '#f4e9d6'
BRASS = '#b08d4f'
INK = '#17150f'
MUTED = '#6f695c'

SVG_TMPL = """<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 512 512'>
<defs><linearGradient id='p' x1='0' y1='0' x2='0' y2='1'>
<stop offset='0' stop-color='{top}'/><stop offset='1' stop-color='{bot}'/></linearGradient></defs>
<rect width='512' height='512' fill='url(#p)'/>
{frame}
<text x='250' y='312' font-family='{glyph_font}' font-size='238' font-weight='600'
      text-anchor='middle' fill='{ink}'>追</text>
<g transform='translate(344,344)'>
<rect x='-54' y='-54' width='108' height='108' rx='28' fill='{brass}'/>
<path d='M -15 -23 L 27 0 L -15 23 Z' fill='{paper}'/>
</g>
<text x='250' y='452' font-family='Georgia,serif' font-size='21' letter-spacing='11'
      text-anchor='middle' fill='{muted}'>TRACKER</text>
</svg>"""


def svg_any(glyph_font):
    frame = ("<rect x='30' y='30' width='452' height='452' rx='46' fill='none' "
             "stroke='{brass}' stroke-width='2.5'/>"
             "<rect x='42' y='42' width='428' height='428' rx='38' fill='none' "
             "stroke='{brass}' stroke-opacity='.42' stroke-width='1.4'/>").format(brass=BRASS)
    return SVG_TMPL.format(top=PAPER_TOP, bot=PAPER_BOT, frame=frame,
                           glyph_font=glyph_font, ink=INK, brass=BRASS, paper=PAPER_TOP, muted=MUTED)


def svg_maskable(glyph_font):
    """maskable：全部内容收进中心 80% 安全区（半径 205），外框撤掉只留内细框。"""
    frame = ("<rect x='66' y='66' width='380' height='380' rx='40' fill='none' "
             "stroke='{brass}' stroke-opacity='.5' stroke-width='1.6'/>").format(brass=BRASS)
    return SVG_TMPL.format(top=PAPER_TOP, bot=PAPER_BOT, frame=frame,
                           glyph_font=glyph_font, ink=INK, brass=BRASS, paper=PAPER_TOP, muted=MUTED)


def render_svg(svg, size, out_png):
    """无头 Chrome 截图栅格化：SVG 直开窗口取整页，背景透明参数保住纸底外的 alpha。"""
    html = ("<body style='margin:0'>"
            + svg.replace("<svg ", "<svg width='%d' height='%d' " % (size, size), 1) + "</body>")
    with tempfile.TemporaryDirectory() as td:
        hp = os.path.join(td, 'i.html')
        with open(hp, 'w', encoding='utf-8') as f:
            f.write(html)
        subprocess.run([CHROME, '--headless=new', '--disable-gpu', '--hide-scrollbars',
                        '--default-background-color=00000000',
                        '--window-size=%d,%d' % (size, size),
                        '--screenshot=%s' % out_png, 'file:///' + hp.replace('\\', '/')],
                       check=True, capture_output=True, timeout=60)


def preview(any_png, mask_png):
    """遮罩预览：圆形/方圆形 + 桌面真实尺寸，左深右浅壁纸；上半=衬线字、下半=楷体对照。"""
    from PIL import ImageDraw
    sheet = Image.new('RGBA', (720, 520), (148, 148, 158, 255))
    sheet.paste(Image.new('RGBA', (360, 520), (246, 243, 238, 255)), (360, 0))
    d = ImageDraw.Draw(sheet)

    def masked(im, size, kind, x, y):
        im = im.resize((size, size), Image.LANCZOS)
        m = Image.new('L', (size, size), 0)
        md = ImageDraw.Draw(m)
        if kind == 'circle':
            md.ellipse([0, 0, size - 1, size - 1], fill=255)
        else:
            md.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.2), fill=255)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        out.paste(im, (0, 0), m)
        sheet.paste(out, (x, y), out)

    for col, im in enumerate([Image.open(any_png).convert('RGBA'), Image.open(mask_png).convert('RGBA')]):
        masked(im, 190, 'circle', 24 + col * 224, 24)
        masked(im, 190, 'round', 24 + col * 224, 236)
        masked(im, 72, 'circle', 470 + col * 100, 40)
        masked(im, 48, 'circle', 470 + col * 100, 140)
    d.text((24, 492), 'left: any(framed)   right: maskable   top row serif / bottom row kai', fill=(255, 255, 255, 255))
    sheet.save(os.path.join(SRC, 'icon-preview-web.png'))


def main():
    any_png = os.path.join(ROOT, 'tracker-icon-512.png')
    mask_png = os.path.join(ROOT, 'tracker-icon-maskable-512.png')
    render_svg(svg_any('Georgia, "Noto Serif SC", serif'), 512, any_png)
    render_svg(svg_maskable('Georgia, "Noto Serif SC", serif'), 512, mask_png)
    # favicon：16/32/48 三档 ICO（从 any 版缩）
    Image.open(any_png).save(os.path.join(ROOT, 'favicon.ico'), format='ICO',
                             sizes=[(16, 16), (32, 32), (48, 48)])
    preview(any_png, mask_png)
    print('OK tracker-icon-512.png / tracker-icon-maskable-512.png / favicon.ico / icon-preview-web.png')


if __name__ == '__main__':
    main()
