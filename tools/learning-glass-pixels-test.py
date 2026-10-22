"""Verify learning screenshots: real background pixels + computed ink/opacity.

Run after learning-glass-browser-test.mjs. Requires Pillow, used only for visual QA.
A three-point median just above each label avoids anti-aliased glyph pixels.
This measures the fixture; it does not certify every possible wallpaper/device.
"""
import json
import re
import statistics
import sys
from pathlib import Path
from PIL import Image, ImageChops, ImageStat

root = Path(sys.argv[1] if len(sys.argv) > 1 else '/tmp/onethu-learning-glass')
report = json.loads((root / 'report.json').read_text())
assert report['passed'], 'Browser interaction checks must pass first'


def luminance(rgb):
    linear = [v / 255 / 12.92 if v / 255 <= .04045 else ((v / 255 + .055) / 1.055) ** 2.4 for v in rgb]
    return sum(v * weight for v, weight in zip(linear, [.2126, .7152, .0722]))


contrasts = []
for sample in report['samples']:
    if 'cardText' not in sample:
        continue
    screenshot = Image.open(root / (sample['label'] + '-' + sample['mode'] + '.png')).convert('RGB')
    for element in sample['cardText']:
        rect = element['rect']
        pixels = []
        for fraction in [.25, .5, .75]:
            x = round((rect['x'] + rect['width'] * fraction) * 2)
            y = round((rect['y'] - 3) * 2)
            pixels.append(screenshot.getpixel((min(screenshot.width - 1, x), max(0, min(screenshot.height - 1, y)))))
        background = [statistics.median(c[i] for c in pixels) for i in range(3)]
        color = [float(v) for v in re.findall(r'[\d.]+', element['probe']['color'])]
        alpha = (color[3] if len(color) > 3 else 1) * float(element['opacity'])
        ink = [a * alpha + b * (1 - alpha) for a, b in zip(color[:3], background)]
        fg_lum, bg_lum = luminance(ink), luminance(background)
        ratio = (max(fg_lum, bg_lum) + .05) / (min(fg_lum, bg_lum) + .05)
        # Deadline is 21px/800; graphical button strokes use the non-text threshold.
        threshold = 3 if 'hw-card-ddl-big' in element['class'] or 'hw-card-act' in element['class'] else 4.5
        entry = dict(viewport=sample['label'], scheme=sample['mode'], css_class=element['class'],
                     background_pixel=background, effective_ink=ink, contrast=ratio, threshold=threshold)
        contrasts.append(entry)
        assert ratio >= threshold, entry

blur = {}
for name in ['card-blur', 'card-old-mask', 'card-own-mask']:
    patch = Image.open(root / (name + '.png')).convert('L').crop((200, 160, 650, 280))
    edges = ImageChops.difference(patch.crop((1, 0, 450, 120)), patch.crop((0, 0, 449, 120)))
    blur[name] = dict(pixel_stddev=ImageStat.Stat(patch).stddev[0], horizontal_edge_mean=ImageStat.Stat(edges).mean[0])
assert blur['card-blur']['pixel_stddev'] < blur['card-old-mask']['pixel_stddev'] / 3, blur
assert blur['card-own-mask']['pixel_stddev'] < blur['card-old-mask']['pixel_stddev'] / 3, blur
(root / 'pixel-proof.json').write_text(json.dumps(dict(passed=True, contrast=contrasts, blur=blur), indent=2))
print(f'{len(contrasts)} actual-pixel contrast checks and 2 backdrop pixel comparisons passed')
