#!/usr/bin/env python3
"""Build a display-safe ESP32 GIF from the authorized dsh-pet idle preview."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageSequence

SOURCE_SIZE = (220, 124)
CROP_BOX = (50, 0, 170, 124)
OUTPUT_SIZE = (84, 84)
BACKGROUND = (32, 41, 54)


def remove_green_background(frame: Image.Image) -> Image.Image:
    rgba = frame.convert("RGBA")
    pixels = rgba.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            red, green, blue, alpha = pixels[x, y]
            if green > 140 and green > red * 1.6 and green > blue * 1.6:
                pixels[x, y] = (*BACKGROUND, alpha)
    return rgba


def fit_frame(frame: Image.Image) -> Image.Image:
    cropped = remove_green_background(frame).crop(CROP_BOX)
    cropped.thumbnail(OUTPUT_SIZE, Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", OUTPUT_SIZE, BACKGROUND)
    offset = ((OUTPUT_SIZE[0] - cropped.width) // 2, (OUTPUT_SIZE[1] - cropped.height) // 2)
    canvas.paste(cropped, offset, cropped)
    return canvas


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-dsh-pet-role-pack.py SOURCE.gif OUTPUT.gif")
    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    source = Image.open(source_path)
    if source.size != SOURCE_SIZE:
        raise SystemExit(f"unexpected source dimensions: {source.size}, expected {SOURCE_SIZE}")
    frames = [fit_frame(frame) for frame in ImageSequence.Iterator(source)]
    durations = [frame.info.get("duration", 50) for frame in ImageSequence.Iterator(source)]
    output_path.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=True,
    )


if __name__ == "__main__":
    main()
