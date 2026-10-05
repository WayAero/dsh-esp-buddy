#!/usr/bin/env python3
"""从随包动画生成分辨率与帧率测试包，保留透明度和原有颜色。"""

from pathlib import Path
import json
from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'role-packs' / 'dsh-pet-maid'
VARIANTS = (
    ('dsh-pet-maid-resolution-test', 128, 1),
    ('dsh-pet-maid-fps-test', 84, 2),
    ('dsh-pet-maid-resolution-fps-test', 128, 2),
)


def palette_frame(frame: Image.Image, size: int) -> Image.Image:
    # 最近邻放大用于增加解码像素量，不引入新颜色或半透明边缘。
    rgba = frame.convert('RGBA').resize((size, size), Image.Resampling.NEAREST)
    raw = rgba.tobytes()
    pixels = [tuple(raw[offset:offset + 4]) for offset in range(0, len(raw), 4)]
    colors = sorted({pixel[:3] for pixel in pixels if pixel[3] != 0})
    if len(colors) > 63:
        raise ValueError('source contains more than 63 opaque colors')
    indexes = {color: index + 1 for index, color in enumerate(colors)}
    result = Image.new('P', (size, size), 0)
    result.putpalette([0, 0, 0] + [channel for color in colors for channel in color])
    result.putdata([indexes[pixel[:3]] if pixel[3] else 0 for pixel in pixels])
    result.info['transparency'] = 0
    return result


def build_gif(source: Path, destination: Path, size: int, speed: int) -> dict:
    frames, durations = [], []
    source_elapsed = output_elapsed = 0
    with Image.open(source) as animation:
        for frame in ImageSequence.Iterator(animation):
            frames.append(palette_frame(frame, size))
            source_elapsed += frame.info['duration']
            # GIF 时长单位为 10 ms；累计舍入保持整个循环的目标时长。
            next_elapsed = round(source_elapsed / speed / 10) * 10
            durations.append(next_elapsed - output_elapsed)
            output_elapsed = next_elapsed
    if min(durations) <= 0:
        raise ValueError('target FPS exceeds GIF timing precision')
    frames[0].save(destination, save_all=True, append_images=frames[1:], duration=durations,
                   loop=0, transparency=0, background=0, disposal=2, optimize=False)
    with Image.open(destination) as saved:
        assert saved.n_frames == len(frames) and saved.size == (size, size)
        assert saved.info['loop'] == 0
        for index, expected in enumerate(frames):
            saved.seek(index)
            assert saved.convert('RGBA').tobytes() == expected.convert('RGBA').tobytes()
            assert saved.info['duration'] == durations[index]
            assert saved.disposal_method == 2
    return {'file': destination.name, 'width': size, 'height': size, 'frames': len(frames),
            'duration_ms': sum(durations), 'fps': len(frames) * 1000 / sum(durations),
            'bytes': destination.stat().st_size}


def main() -> None:
    report = {}
    for name, size, speed in VARIANTS:
        directory = ROOT / 'role-packs' / name
        directory.mkdir(exist_ok=True)
        manifest = json.loads((SOURCE / 'manifest.json').read_text(encoding='utf-8'))
        manifest['name'] = name
        (directory / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        notice_text = (SOURCE / 'NOTICE.txt').read_text(encoding='utf-8').replace('本角色包的 GIF', '基础角色包 dsh-pet-maid 的 GIF')
        (directory / 'NOTICE.txt').write_text(notice_text, encoding='utf-8')
        with (directory / 'NOTICE.txt').open('a', encoding='utf-8') as notice:
            notice.write(f'\n测试变体：基于本仓库 dsh-pet-maid 的 80 帧透明动画，最近邻缩放为 {size}×{size}，'
                         f'播放速度为原来的 {speed} 倍。保留原有颜色、透明度与素材使用限制。\n')
        report[name] = [build_gif(path, directory / path.name, size, speed) for path in sorted(SOURCE.glob('*.gif'))]
    report_path = ROOT / 'docs' / 'local' / 'role-pack-test-variants.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
