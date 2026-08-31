#!/usr/bin/env python3
"""Build a compact ESP32 GIF with the Buddy card background (#17181C)."""

from __future__ import annotations

import sys
from pathlib import Path

from PIL import Image, ImageSequence

SOURCE_SIZE = (220, 124)
CROP_BOX = (50, 0, 170, 124)
OUTPUT_SIZE = (84, 84)
# Keep the opaque GIF canvas visually continuous with the ESP32 Buddy card.
BACKGROUND = (23, 24, 28)  # #17181C
FRAME_STEP = 2
PALETTE_COLORS = 64


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
    return canvas.quantize(
        colors=PALETTE_COLORS,
        method=Image.Quantize.MEDIANCUT,
        dither=Image.Dither.NONE,
    )


def compact_frames(source: Image.Image) -> tuple[list[Image.Image], list[int]]:
    frames: list[Image.Image] = []
    durations: list[int] = []
    pending_duration = 0
    for index, frame in enumerate(ImageSequence.Iterator(source)):
        pending_duration += frame.info.get("duration", 50)
        if index % FRAME_STEP != FRAME_STEP - 1 and index + 1 < source.n_frames:
            continue
        frames.append(fit_frame(frame))
        durations.append(pending_duration)
        pending_duration = 0
    return frames, durations


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: build-dsh-pet-role-pack.py SOURCE.gif OUTPUT.gif")
    source_path = Path(sys.argv[1])
    output_path = Path(sys.argv[2])
    source = Image.open(source_path)
    if source.size != SOURCE_SIZE:
        raise SystemExit(f"unexpected source dimensions: {source.size}, expected {SOURCE_SIZE}")
    frames, durations = compact_frames(source)
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
