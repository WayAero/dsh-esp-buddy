#!/usr/bin/env python3
"""Build a compact transparent ESP32 GIF from the original green-screen animation."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageSequence

SOURCE_SIZE = (220, 124)
CROP_BOX = (50, 0, 170, 124)
OUTPUT_SIZE = (84, 84)
# GIF 只有完全透明和不透明；索引 0 留给透明像素，不占用角色颜色。
TRANSPARENT_INDEX = 0
ALPHA_THRESHOLD = 128
DEFAULT_FRAME_COUNT = 80
DEFAULT_PALETTE_COLORS = 64


def remove_green_background(frame: Image.Image) -> Image.Image:
    rgba = frame.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if green > 140 and green > red * 1.6 and green > blue * 1.6:
                pixels[x, y] = (0, 0, 0, 0)
    return rgba


def fit_frame(frame: Image.Image, palette_colors: int) -> Image.Image:
    cropped = remove_green_background(frame).crop(CROP_BOX)
    cropped.thumbnail(OUTPUT_SIZE, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", OUTPUT_SIZE, (0, 0, 0, 0))
    offset = ((OUTPUT_SIZE[0] - cropped.width) // 2, (OUTPUT_SIZE[1] - cropped.height) // 2)
    canvas.paste(cropped, offset)
    # 先以 RGBA 缩放，避免把旧底色混入轮廓，再将边缘透明度二值化。
    alpha = canvas.getchannel("A")
    quantized = canvas.convert("RGB").quantize(
        colors=palette_colors - 1,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )
    result = Image.new("P", OUTPUT_SIZE, TRANSPARENT_INDEX)
    palette = [0, 0, 0] + quantized.getpalette()[: (palette_colors - 1) * 3]
    result.putpalette(palette)
    result.putdata([
        index + 1 if opacity >= ALPHA_THRESHOLD else TRANSPARENT_INDEX
        for index, opacity in zip(quantized.tobytes(), alpha.tobytes())
    ])
    result.info["transparency"] = TRANSPARENT_INDEX
    return result


def compact_frames(source: Image.Image, frame_count: int, palette_colors: int) -> tuple[list[Image.Image], list[int]]:
    if not 1 <= frame_count <= source.n_frames:
        raise ValueError(f"frame count must be between 1 and {source.n_frames}")
    frames: list[Image.Image] = []
    durations: list[int] = []
    pending_duration = 0
    for index, frame in enumerate(ImageSequence.Iterator(source)):
        pending_duration += frame.info.get("duration", 50)
        # Pick frames evenly across the source animation.  This keeps its total
        # duration while retaining more distinct poses when the frame budget grows.
        if (index + 1) * frame_count // source.n_frames == index * frame_count // source.n_frames and index + 1 < source.n_frames:
            continue
        frames.append(fit_frame(frame, palette_colors))
        durations.append(pending_duration)
        pending_duration = 0
    return frames, durations


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--frame-count", type=int, default=DEFAULT_FRAME_COUNT)
    parser.add_argument("--palette-colors", type=int, default=DEFAULT_PALETTE_COLORS)
    args = parser.parse_args()
    if not 2 <= args.palette_colors <= 256:
        parser.error("--palette-colors must be between 2 and 256")
    source_path = Path(args.source)
    output_path = Path(args.output)
    source = Image.open(source_path)
    if source.size != SOURCE_SIZE:
        raise SystemExit(f"unexpected source dimensions: {source.size}, expected {SOURCE_SIZE}")
    frames, durations = compact_frames(source, args.frame_count, args.palette_colors)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        transparency=TRANSPARENT_INDEX,
        background=TRANSPARENT_INDEX,
        disposal=2,
        # 保留透明索引和每帧调色板；帧清理为恢复透明背景，避免移动残影。
        optimize=False,
    )
    # 检查真实保存结果，覆盖局部帧、调色板切换和 disposal 的组合行为。
    with Image.open(output_path) as saved:
        if saved.n_frames != len(frames) or saved.info.get("loop") != 0:
            raise ValueError("saved animation frame count or loop differs from source")
        for index, expected in enumerate(frames):
            saved.seek(index)
            actual = saved.convert("RGBA")
            if actual.tobytes() != expected.convert("RGBA").tobytes():
                raise ValueError(f"saved frame {index} differs from generated frame")
            if saved.info.get("duration") != durations[index]:
                raise ValueError(f"saved frame {index} duration differs from source")


if __name__ == "__main__":
    main()
