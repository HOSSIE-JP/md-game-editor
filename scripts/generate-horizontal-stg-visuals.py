from __future__ import annotations

import argparse
import math
import random
from pathlib import Path
from typing import Callable, Iterable, Sequence

from PIL import Image, ImageDraw, ImageFilter, ImageOps


REPO = Path(__file__).resolve().parents[1]
TILE_SIZE = 8
SCREEN_SIZE = (320, 224)
STAGE_HEIGHT = 224
STAGE_LENGTHS = (6144, 6656, 7168, 7680, 8192)
STAGE_PARALLAX_SHIFTS = (2, 1, 2, 1, 2)

BUILDER_GFX = REPO / "plugins" / "horizontal-stg-builder" / "template" / "res" / "gfx"
GERONEKO_GFX = REPO / "template" / "template_geroneko_abyss_strike" / "res" / "gfx"
DEFAULT_TITLE_SOURCE = REPO / "artifacts" / "horizontal-stg" / "sources" / "title-background-imagegen-source.png"


STAGE_PALETTES: tuple[tuple[tuple[int, int, int], ...], ...] = (
    (
        (0, 0, 24), (8, 16, 48), (16, 32, 72), (24, 56, 104),
        (40, 88, 136), (72, 136, 176), (112, 184, 200), (200, 224, 216),
        (248, 216, 136), (248, 160, 72), (224, 88, 64), (160, 48, 72),
        (56, 48, 88), (24, 72, 120), (48, 120, 168), (232, 240, 232),
    ),
    (
        (0, 0, 24), (8, 24, 48), (16, 48, 64), (24, 72, 80),
        (32, 96, 104), (48, 128, 128), (72, 160, 152), (112, 192, 176),
        (176, 216, 192), (216, 232, 200), (24, 40, 56), (40, 56, 64),
        (64, 72, 72), (104, 96, 72), (192, 152, 72), (240, 208, 112),
    ),
    (
        (0, 0, 16), (8, 8, 40), (16, 16, 64), (32, 24, 88),
        (56, 32, 112), (80, 48, 128), (32, 72, 96), (40, 104, 104),
        (64, 136, 120), (104, 176, 136), (144, 208, 152), (72, 88, 144),
        (104, 120, 176), (152, 160, 208), (208, 208, 232), (232, 240, 248),
    ),
    (
        (0, 0, 16), (16, 16, 24), (32, 32, 40), (48, 48, 56),
        (72, 64, 64), (96, 80, 72), (128, 96, 72), (168, 120, 72),
        (216, 152, 72), (240, 192, 96), (56, 72, 88), (72, 96, 120),
        (96, 128, 152), (128, 160, 176), (184, 200, 200), (232, 232, 216),
    ),
    (
        (0, 0, 16), (24, 8, 32), (48, 16, 48), (72, 24, 64),
        (104, 32, 72), (136, 48, 80), (168, 72, 88), (200, 104, 104),
        (224, 144, 120), (240, 184, 152), (32, 72, 72), (48, 104, 88),
        (72, 136, 104), (104, 176, 128), (160, 216, 160), (224, 240, 208),
    ),
)

TITLE_PALETTE: tuple[tuple[int, int, int], ...] = (
    (0, 0, 24), (8, 8, 48), (8, 24, 72), (16, 48, 104),
    (32, 72, 136), (56, 104, 168), (48, 40, 80), (88, 48, 88),
    (136, 48, 80), (184, 64, 72), (232, 96, 64), (248, 144, 72),
    (248, 200, 112), (160, 184, 192), (64, 184, 216), (240, 240, 224),
)

LOGO_PALETTE: tuple[tuple[int, int, int], ...] = (
    (0, 0, 0), (8, 16, 40), (16, 40, 80), (24, 72, 120),
    (32, 112, 160), (48, 160, 200), (88, 208, 224), (168, 240, 232),
    (240, 248, 232), (248, 208, 104), (248, 144, 56), (224, 72, 48),
    (160, 40, 64), (96, 24, 72), (48, 16, 56), (255, 255, 255),
)

Tile = tuple[int, ...]


def flatten_palette(palette: Sequence[tuple[int, int, int]]) -> list[int]:
    entries = list(palette[:256])
    entries.extend([(0, 0, 0)] * (256 - len(entries)))
    return [channel for color in entries for channel in color]


def save_indexed(image: Image.Image, palette: Sequence[tuple[int, int, int]], path: Path, transparent: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.putpalette(flatten_palette(palette))
    options: dict[str, int | bool] = {"optimize": True}
    if transparent:
        options["transparency"] = 0
    image.save(path, **options)


def solid(color: int) -> Tile:
    return (color,) * (TILE_SIZE * TILE_SIZE)


def patterned(a: int, b: int, phase: int = 0, density: int = 2) -> Tile:
    values: list[int] = []
    for y in range(TILE_SIZE):
        for x in range(TILE_SIZE):
            values.append(b if ((x + y * 3 + phase) & 3) < density else a)
    return tuple(values)


def stripe(a: int, b: int, phase: int = 0, vertical: bool = False) -> Tile:
    values: list[int] = []
    for y in range(TILE_SIZE):
        for x in range(TILE_SIZE):
            axis = x if vertical else y
            values.append(b if ((axis + phase) & 3) == 0 else a)
    return tuple(values)


def rock(fill: int, shadow: int, highlight: int, variant: int = 0) -> Tile:
    values = [fill] * 64
    for y in range(8):
        for x in range(8):
            if ((x * 3 + y * 5 + variant * 7) % 17) == 0:
                values[y * 8 + x] = highlight
            elif ((x * 5 - y * 3 + variant * 11) % 19) == 0:
                values[y * 8 + x] = shadow
    for x in range(1 + (variant & 1), 7, 4):
        y = (x * 2 + variant * 3) & 7
        values[y * 8 + x] = shadow
        if y + 1 < 8:
            values[(y + 1) * 8 + x] = shadow
    return tuple(values)


def wave(base: int, crest: int, shade: int, phase: int = 0) -> Tile:
    curve = (3, 2, 2, 3, 4, 5, 5, 4)
    values = [base] * 64
    for x in range(8):
        y = curve[(x + phase) & 7]
        values[y * 8 + x] = crest
        if y + 1 < 8:
            values[(y + 1) * 8 + x] = shade
        if ((x + phase) & 3) == 0 and y > 0:
            values[(y - 1) * 8 + x] = crest
    return tuple(values)


def cloud(base: int, light: int, shade: int, variant: int = 0) -> Tile:
    values = [base] * 64
    cx = (2, 4, 5, 3)[variant & 3]
    cy = (4, 3, 4, 5)[variant & 3]
    for y in range(8):
        for x in range(8):
            dx = x - cx
            dy = y - cy
            if (dx * dx * 2 + dy * dy * 3) <= 24 or ((x - 5) ** 2 + (y - 5) ** 2) <= 8:
                values[y * 8 + x] = shade if y >= cy + 1 else light
    return tuple(values)


def edge(fill: int, shadow: int, highlight: int, phase: int, from_top: bool) -> Tile:
    profile = (3, 3, 4, 4, 5, 4, 3, 3)
    values = [0] * 64
    for x in range(8):
        boundary = profile[(x + phase) & 7]
        for y in range(8):
            inside = y <= boundary if from_top else y >= 7 - boundary
            if not inside:
                continue
            boundary_y = boundary if from_top else 7 - boundary
            if y == boundary_y:
                color = highlight
            elif (from_top and y == boundary_y - 1) or ((not from_top) and y == boundary_y + 1):
                color = shadow
            else:
                color = fill
            values[y * 8 + x] = color
    return tuple(values)


def city_tile(fill: int, border: int, light: int, variant: int = 0) -> Tile:
    values = [fill] * 64
    for y in range(8):
        values[y * 8] = border
    for y in (2, 5):
        for x in (2 + (variant & 1), 5 - (variant & 1)):
            values[y * 8 + x] = light if ((x + y + variant) & 1) == 0 else border
    return tuple(values)


def panel(fill: int, seam: int, light: int, variant: int = 0) -> Tile:
    values = [fill] * 64
    for x in range(8):
        values[x] = seam
        values[7 * 8 + x] = seam
    for y in range(8):
        values[y * 8] = seam
        values[y * 8 + 7] = seam
    values[(2 + (variant & 1) * 3) * 8 + 2] = light
    values[(5 - (variant & 1) * 3) * 8 + 5] = light
    return tuple(values)


def pipe(fill: int, shadow: int, light: int, direction: str) -> Tile:
    values = [0] * 64
    if direction in ("h", "cross", "ne", "nw", "se", "sw"):
        for y in range(2, 6):
            for x in range(8):
                values[y * 8 + x] = light if y == 2 else (shadow if y == 5 else fill)
    if direction in ("v", "cross", "ne", "nw", "se", "sw"):
        for y in range(8):
            for x in range(2, 6):
                values[y * 8 + x] = light if x == 2 else (shadow if x == 5 else fill)
    if direction == "ne":
        for y in range(4, 8):
            for x in range(4, 8):
                values[y * 8 + x] = 0
    elif direction == "nw":
        for y in range(4, 8):
            for x in range(0, 4):
                values[y * 8 + x] = 0
    elif direction == "se":
        for y in range(0, 4):
            for x in range(4, 8):
                values[y * 8 + x] = 0
    elif direction == "sw":
        for y in range(0, 4):
            for x in range(0, 4):
                values[y * 8 + x] = 0
    return tuple(values)


def organic(fill: int, vein: int, glow: int, variant: int = 0) -> Tile:
    values = [fill] * 64
    center = (variant * 3 + 2) & 7
    for y in range(8):
        x = (center + ((y & 3) - 1)) & 7
        values[y * 8 + x] = vein
        if (y + variant) % 5 == 0:
            values[y * 8 + ((x + 1) & 7)] = glow
    return tuple(values)


def detail_tile(tile: Tile, seed: int, shadow: int, highlight: int, amount: int = 5) -> Tile:
    """Add deterministic 1px clusters to an existing 8x8 motif.

    Seeds are deliberately folded by callers so the vocabulary stays bounded;
    this is MD-style authored variation, not unbounded per-tile noise.
    """
    values = list(tile)
    rng = random.Random(seed & 0xFFFF)
    candidates = [index for index, value in enumerate(values) if value != 0]
    if not candidates:
        candidates = list(range(64))
    for index in range(amount):
        pixel = candidates[rng.randrange(len(candidates))]
        values[pixel] = highlight if (index + seed) & 1 else shadow
        if index % 3 == 0:
            neighbor = pixel + (1 if (pixel & 7) < 7 else -1)
            if values[neighbor] != 0:
                values[neighbor] = shadow
    return tuple(values)


def gradient_dither(top: int, bottom: int, accent: int, variant: int = 0) -> Tile:
    values: list[int] = []
    split = 2 + (variant % 5)
    for y in range(8):
        for x in range(8):
            if y < split:
                color = top
            elif y > split + 1:
                color = bottom
            else:
                color = top if ((x + y + variant) & 1) else bottom
            if ((x * 5 + y * 3 + variant * 7) % 29) == 0:
                color = accent
            values.append(color)
    return tuple(values)


def riveted_panel(fill: int, seam: int, light: int, shade: int, variant: int = 0) -> Tile:
    values = list(panel(fill, seam, light, variant))
    for x, y in ((1, 1), (6, 1), (1, 6), (6, 6)):
        values[y * 8 + x] = light if ((x + y + variant) & 1) else shade
    if variant & 2:
        for diagonal in range(2, 6):
            values[diagonal * 8 + diagonal] = shade
    return tuple(values)


def lattice(fill: int, beam: int, light: int, variant: int = 0) -> Tile:
    values = [fill] * 64
    for y in range(8):
        for x in range(8):
            if x in (0, 7) or y in (0, 7) or ((x + y + variant) % 7 == 0):
                values[y * 8 + x] = beam
    values[(2 + (variant & 3)) * 8 + (5 - (variant & 3))] = light
    return tuple(values)


def crystal(fill: int, shade: int, light: int, glow: int, variant: int = 0) -> Tile:
    values = [0] * 64
    center = 2 + (variant & 3)
    for y in range(1, 8):
        half = min(3, y // 2)
        for x in range(max(0, center - half), min(8, center + half + 1)):
            values[y * 8 + x] = light if x == center - half else (shade if x == center + half else fill)
    values[min(7, 5 + (variant & 1)) * 8 + center] = glow
    return tuple(values)


def membrane(fill: int, vein: int, glow: int, shadow: int, variant: int = 0) -> Tile:
    values = list(organic(fill, vein, glow, variant))
    for y in range(8):
        wave_x = (variant * 3 + y * 2 + (y >> 1)) & 7
        if (y + variant) & 1:
            values[y * 8 + wave_x] = shadow
    return tuple(values)


class TileLayer:
    def __init__(self, width_px: int, height_px: int, default: Tile) -> None:
        if width_px % 8 or height_px % 8:
            raise ValueError("TileLayer dimensions must be divisible by 8")
        self.width_tiles = width_px // 8
        self.height_tiles = height_px // 8
        self.tiles: list[list[Tile]] = [[default for _ in range(self.width_tiles)] for _ in range(self.height_tiles)]

    def get(self, x: int, y: int) -> Tile:
        return self.tiles[y][x]

    def set(self, x: int, y: int, tile: Tile) -> None:
        if 0 <= x < self.width_tiles and 0 <= y < self.height_tiles:
            self.tiles[y][x] = tile

    def overlay(self, x: int, y: int, painter: Callable[[int, int], int | None]) -> None:
        if not (0 <= x < self.width_tiles and 0 <= y < self.height_tiles):
            return
        values = list(self.tiles[y][x])
        for py in range(8):
            for px in range(8):
                color = painter(px, py)
                if color is not None:
                    values[py * 8 + px] = color
        self.tiles[y][x] = tuple(values)

    def render(self) -> Image.Image:
        width = self.width_tiles * 8
        height = self.height_tiles * 8
        raw = bytearray(width * height)
        for ty, row in enumerate(self.tiles):
            for tx, tile in enumerate(row):
                for py in range(8):
                    start = ((ty * 8 + py) * width) + tx * 8
                    raw[start:start + 8] = bytes(tile[py * 8:py * 8 + 8])
        return Image.frombytes("P", (width, height), bytes(raw))

    def unique_patterns(self) -> int:
        return len({tile for row in self.tiles for tile in row})


def fill_gradient(layer: TileLayer, rows: Sequence[Tile]) -> None:
    for ty in range(layer.height_tiles):
        tile = rows[min(len(rows) - 1, (ty * len(rows)) // layer.height_tiles)]
        for tx in range(layer.width_tiles):
            layer.set(tx, ty, tile if ((tx + ty) & 1) == 0 else rows[min(len(rows) - 1, (ty * len(rows)) // layer.height_tiles)])


def overlay_circle(layer: TileLayer, center_x: int, center_y: int, radius: int, fill: int, rim: int, glow: int) -> None:
    left = max(0, (center_x - radius - 2) // 8)
    right = min(layer.width_tiles, (center_x + radius + 9) // 8)
    top = max(0, (center_y - radius - 2) // 8)
    bottom = min(layer.height_tiles, (center_y + radius + 9) // 8)
    for ty in range(top, bottom):
        for tx in range(left, right):
            def painter(px: int, py: int, tx: int = tx, ty: int = ty) -> int | None:
                dx = tx * 8 + px - center_x
                dy = ty * 8 + py - center_y
                distance2 = dx * dx + dy * dy
                if distance2 <= (radius - 5) * (radius - 5):
                    if abs(dx) < 4 or abs(dy) < 3:
                        return glow
                    return fill
                if distance2 <= radius * radius:
                    return rim
                return None
            layer.overlay(tx, ty, painter)


def stage_one(width_b: int, width_a: int) -> tuple[TileLayer, TileLayer]:
    # BLUE HORIZON: layered sunset, cloud banks, islands and reflective ocean.
    bg = TileLayer(width_b, 224, solid(1))
    sky_bands = ((1, 2, 3), (2, 3, 4), (3, 4, 9), (9, 10, 8), (10, 9, 7))
    for ty in range(20):
        band = min(len(sky_bands) - 1, ty * len(sky_bands) // 20)
        top, bottom, accent = sky_bands[band]
        for tx in range(bg.width_tiles):
            variant = (tx * 5 + ty * 11) % 24
            base = gradient_dither(top, bottom, accent, variant % 5)
            bg.set(tx, ty, detail_tile(base, variant, top, accent, 2 + (variant % 3)))
    overlay_circle(bg, 74 * 8, 88, 34, 8, 9, 15)
    for center in range(18, bg.width_tiles, 47):
        cloud_y = 4 + ((center // 47) % 8)
        length = 7 + ((center // 13) % 8)
        for offset in range(length):
            tx = center + offset
            if tx >= bg.width_tiles:
                break
            bg.set(tx, cloud_y + ((offset // 4) & 1), detail_tile(cloud(2, 7, 6, offset & 3), (center + offset) % 20, 5, 15, 3))
    for tx in range(bg.width_tiles):
        horizon = 18 + ((tx // 17 + tx // 43) % 3)
        if (tx % 43) < 13:
            bg.set(tx, horizon, edge(12, 11, 8, tx & 7, False))
            if (tx % 43) in (5, 6):
                bg.set(tx, horizon - 1, rock(12, 11, 8, tx & 7))
        for ty in range(20, 28):
            water_base = 13 if ty < 23 else 2
            tile = wave(water_base, 15 if ((tx + ty) % 5 == 0) else 6, 14, (tx * 3 + ty) & 7)
            bg.set(tx, ty, detail_tile(tile, (tx * 7 + ty) % 28, 3, 15, 2))
        if 60 <= (tx % 97) <= 66:
            bg.set(tx, 21 + ((tx - 60) & 1), stripe(9, 15, tx, True))
    fg = TileLayer(width_a, 224, solid(0))
    for tx in range(fg.width_tiles):
        variant = (tx * 9) % 32
        fg.set(tx, 26, detail_tile(edge(14, 13, 15, tx & 7, False), variant, 12, 15, 4))
        fg.set(tx, 27, detail_tile(rock(13, 12, 14, tx & 7), variant + 3, 11, 15, 5))
        if tx % 29 in (0, 1, 2):
            fg.set(tx, 25, crystal(6, 13, 15, 7, tx & 3))
        if tx % 41 in (11, 12):
            for ty in range(23, 27):
                fg.set(tx, ty, organic(0, 14, 15, (tx + ty) & 3))
    return bg, fg


def stage_two(width_b: int, width_a: int) -> tuple[TileLayer, TileLayer]:
    # DROWNED METRO: deep water gradient, varied skyline, bridges, signs and pipes.
    bg = TileLayer(width_b, 224, solid(1))
    for ty in range(28):
        base = 1 + min(7, ty // 4)
        for tx in range(bg.width_tiles):
            variant = (tx * 11 + ty * 3) % 30
            tile = gradient_dither(base, min(9, base + 1), 7, variant % 5)
            bg.set(tx, ty, detail_tile(tile, variant, max(1, base - 1), min(9, base + 2), 3))
    rng = random.Random(0xD20)
    x = 0
    building = 0
    while x < bg.width_tiles:
        width = rng.randint(4, 12)
        top = rng.randint(5, 15)
        fill = 10 + (building & 1)
        for tx in range(x, min(bg.width_tiles, x + width)):
            for ty in range(top, 27):
                variant = (tx * 5 + ty * 7 + building) % 32
                tile = city_tile(fill, 11, 15 if ((tx + ty + building) % 4 == 0) else 14, variant & 3)
                bg.set(tx, ty, detail_tile(tile, variant, 12, 15, 3))
            bg.overlay(tx, top, lambda px, py, phase=(tx + building): fill if py >= 2 + ((px + phase) & 1) else None)
        if x + width // 2 < bg.width_tiles:
            bg.set(x + width // 2, max(1, top - 1), pipe(12, 10, 15, 'v'))
        if width >= 8 and x + 3 < bg.width_tiles:
            bg.set(x + 2, top + 3, stripe(13, 15, building, False))
            bg.set(x + 3, top + 3, stripe(13, 14, building + 1, False))
        x += width + rng.randint(1, 4)
        building += 1
    for tx in range(bg.width_tiles):
        if (tx % 53) < 39:
            bg.set(tx, 16, detail_tile(lattice(0, 12, 15, tx & 3), tx % 24, 10, 15, 2))
        if (tx % 61) < 50:
            bg.set(tx, 4, detail_tile(pipe(12, 10, 15, 'h'), tx % 28, 11, 15, 2))
    fg = TileLayer(width_a, 224, solid(0))
    for tx in range(fg.width_tiles):
        variant = (tx * 13) % 32
        if (tx % 72) < 50:
            fg.set(tx, 2, detail_tile(pipe(12, 10, 15, 'h'), variant, 10, 15, 3))
        if tx % 36 in (0, 1):
            for ty in range(3, 11):
                fg.set(tx, ty, detail_tile(lattice(0, 12, 15, ty & 3), (variant + ty) % 32, 10, 15, 2))
        fg.set(tx, 25, detail_tile(edge(11, 10, 15, tx & 7, False), variant, 10, 15, 4))
        fg.set(tx, 26, riveted_panel(11, 10, 15, 12, tx & 3))
        fg.set(tx, 27, detail_tile(rock(11, 10, 13, tx & 7), variant + 7, 10, 15, 4))
    return bg, fg


def stage_three(width_b: int, width_a: int) -> tuple[TileLayer, TileLayer]:
    # BLACK LANTERN: layered cave, stalactites, crystal seams and bioluminescent growth.
    bg = TileLayer(width_b, 224, solid(1))
    for ty in range(28):
        base = 1 + min(6, abs(13 - ty) // 3)
        for tx in range(bg.width_tiles):
            variant = (tx * 7 + ty * 13) % 36
            bg.set(tx, ty, detail_tile(patterned(base, min(10, base + 2), variant, 1), variant, max(1, base - 1), min(15, base + 5), 5))
    for tx in range(bg.width_tiles):
        top = 2 + ((tx // 5 + tx // 17 + tx // 47) % 7)
        bottom = 23 - ((tx // 7 + tx // 19 + tx // 41) % 6)
        variant = (tx * 11) % 40
        for ty in range(top):
            bg.set(tx, ty, detail_tile(rock(3, 2, 11, (tx + ty) & 7), (variant + ty) % 40, 2, 12, 5))
        bg.set(tx, top, detail_tile(edge(3, 2, 12, tx & 7, True), variant, 2, 13, 3))
        bg.set(tx, bottom, detail_tile(edge(3, 2, 12, tx & 7, False), variant + 5, 2, 13, 3))
        for ty in range(bottom + 1, 28):
            bg.set(tx, ty, detail_tile(rock(3, 2, 11, (tx + ty) & 7), (variant + ty) % 40, 2, 12, 5))
        if tx % 19 in (4, 5):
            bg.set(tx, 12 + (tx % 5), crystal(7, 6, 14, 15, tx & 3))
        if tx % 31 == 9:
            bg.set(tx, top + 2, membrane(6, 8, 15, 5, tx & 3))
    fg = TileLayer(width_a, 224, solid(0))
    for tx in range(fg.width_tiles):
        top = 1 + ((tx // 7 + tx // 23) % 6)
        bottom = 24 - ((tx // 9 + tx // 29) % 5)
        variant = (tx * 17) % 44
        for ty in range(top):
            fg.set(tx, ty, detail_tile(rock(4, 3, 12, (tx + ty) & 7), (variant + ty) % 44, 2, 13, 6))
        fg.set(tx, top, detail_tile(edge(4, 3, 13, tx & 7, True), variant, 3, 14, 4))
        fg.set(tx, bottom, detail_tile(edge(4, 3, 13, tx & 7, False), variant + 3, 3, 14, 4))
        for ty in range(bottom + 1, 28):
            fg.set(tx, ty, detail_tile(rock(4, 3, 12, (tx + ty) & 7), (variant + ty) % 44, 2, 13, 6))
        if tx % 27 in (6, 7):
            fg.set(tx, top + 1, crystal(8, 6, 15, 14, tx & 3))
    return bg, fg


def stage_four(width_b: int, width_a: int) -> tuple[TileLayer, TileLayer]:
    # IRON NEST: riveted bulkheads, furnace ports, gears, pipes and hazard decks.
    bg = TileLayer(width_b, 224, solid(2))
    for ty in range(28):
        for tx in range(bg.width_tiles):
            variant = (tx * 13 + ty * 7) % 40
            fill = 2 + ((ty // 5 + tx // 17) & 1)
            tile = riveted_panel(fill, 1, 9 if ((tx + ty) % 7 == 0) else 10, 4, variant & 3)
            bg.set(tx, ty, detail_tile(tile, variant, 3, 14, 3))
    for center_tx in range(24, bg.width_tiles, 48):
        radius = 30 + ((center_tx // 48) & 1) * 8
        overlay_circle(bg, center_tx * 8, 112, radius, 1, 7, 9)
        for spoke in range(-4, 5, 2):
            tx = center_tx + spoke
            if 0 <= tx < bg.width_tiles:
                bg.set(tx, 13 + (spoke & 1), lattice(1, 7, 9, spoke & 3))
    for tx in range(bg.width_tiles):
        variant = (tx * 19) % 44
        if (tx % 43) < 31:
            bg.set(tx, 4, detail_tile(pipe(11, 10, 14, 'h'), variant, 10, 15, 3))
        if tx % 43 in (0, 30):
            for ty in range(4, 22):
                bg.set(tx, ty, detail_tile(pipe(11, 10, 14, 'v'), (variant + ty) % 44, 10, 15, 2))
        if tx % 23 in (3, 4):
            bg.set(tx, 23, stripe(7, 9, tx, True))
            bg.set(tx, 24, stripe(1, 8, tx + 2, True))
    fg = TileLayer(width_a, 224, solid(0))
    for tx in range(fg.width_tiles):
        variant = (tx * 23) % 48
        if (tx % 67) < 47:
            fg.set(tx, 1, detail_tile(pipe(12, 10, 15, 'h'), variant, 10, 15, 3))
        if tx % 34 in (0, 1):
            for ty in range(2, 10):
                fg.set(tx, ty, detail_tile(lattice(0, 12, 15, ty & 3), (variant + ty) % 48, 10, 15, 3))
        fg.set(tx, 24, detail_tile(edge(5, 3, 14, tx & 7, False), variant, 3, 15, 4))
        fg.set(tx, 25, riveted_panel(4, 2, 9, 6, tx & 3))
        fg.set(tx, 26, stripe(7, 9, tx, True))
        fg.set(tx, 27, detail_tile(panel(3, 1, 14, tx & 3), variant + 7, 2, 15, 4))
    return bg, fg


def stage_five(width_b: int, width_a: int) -> tuple[TileLayer, TileLayer]:
    # LIVING ARK: layered membranes, branching veins, cells, eyes and rib-like foreground.
    bg = TileLayer(width_b, 224, solid(1))
    for ty in range(28):
        for tx in range(bg.width_tiles):
            variant = (tx * 17 + ty * 11) % 48
            base = 2 + ((ty // 5 + tx // 29) & 3)
            tile = membrane(base, 5, 13 if ((tx + ty) % 5 == 0) else 11, 3, variant & 7)
            bg.set(tx, ty, detail_tile(tile, variant, 3, 14, 4))
    for center_tx in range(28, bg.width_tiles, 56):
        radius = 24 + ((center_tx // 56) % 3) * 6
        center_y = 72 + ((center_tx // 17) % 11) * 8
        overlay_circle(bg, center_tx * 8, center_y, radius, 3, 8, 14)
        overlay_circle(bg, center_tx * 8, center_y, max(7, radius // 3), 1, 15, 15)
    for tx in range(bg.width_tiles):
        variant = (tx * 29) % 52
        if tx % 14 in (0, 1):
            for ty in range(2, 26):
                bg.set(tx, ty, detail_tile(membrane(4, 6, 14, 3, (tx + ty) & 7), (variant + ty) % 52, 2, 15, 4))
        if tx % 37 in (9, 10, 11):
            bg.set(tx, 6 + (tx % 15), crystal(10, 5, 14, 15, tx & 3))
    fg = TileLayer(width_a, 224, solid(0))
    for tx in range(fg.width_tiles):
        top = 2 + ((tx // 7 + tx // 23 + tx // 61) % 6)
        bottom = 23 - ((tx // 9 + tx // 27 + tx // 53) % 5)
        variant = (tx * 31) % 56
        for ty in range(top):
            fg.set(tx, ty, detail_tile(membrane(4, 6, 14, 3, (tx + ty) & 7), (variant + ty) % 56, 2, 15, 5))
        fg.set(tx, top, detail_tile(edge(5, 3, 14, tx & 7, True), variant, 3, 15, 4))
        fg.set(tx, bottom, detail_tile(edge(5, 3, 14, tx & 7, False), variant + 3, 3, 15, 4))
        for ty in range(bottom + 1, 28):
            fg.set(tx, ty, detail_tile(membrane(4, 6, 14, 3, (tx + ty) & 7), (variant + ty) % 56, 2, 15, 5))
        if tx % 21 in (5, 6):
            fg.set(tx, top + 1, pipe(12, 10, 15, 'v'))
    return bg, fg


STAGE_BUILDERS: tuple[Callable[[int, int], tuple[TileLayer, TileLayer]], ...] = (
    stage_one, stage_two, stage_three, stage_four, stage_five,
)


PIXEL_FONT = {
    "A": ("01110", "10001", "10001", "11111", "10001", "10001", "10001"),
    "B": ("11110", "10001", "10001", "11110", "10001", "10001", "11110"),
    "E": ("11111", "10000", "10000", "11110", "10000", "10000", "11111"),
    "G": ("01111", "10000", "10000", "10111", "10001", "10001", "01110"),
    "H": ("10001", "10001", "10001", "11111", "10001", "10001", "10001"),
    "I": ("11111", "00100", "00100", "00100", "00100", "00100", "11111"),
    "K": ("10001", "10010", "10100", "11000", "10100", "10010", "10001"),
    "L": ("10000", "10000", "10000", "10000", "10000", "10000", "11111"),
    "N": ("10001", "11001", "11001", "10101", "10011", "10011", "10001"),
    "O": ("01110", "10001", "10001", "10001", "10001", "10001", "01110"),
    "R": ("11110", "10001", "10001", "11110", "10100", "10010", "10001"),
    "S": ("01111", "10000", "10000", "01110", "00001", "00001", "11110"),
    "T": ("11111", "00100", "00100", "00100", "00100", "00100", "00100"),
    "Y": ("10001", "10001", "01010", "00100", "00100", "00100", "00100"),
    "Z": ("11111", "00001", "00010", "00100", "01000", "10000", "11111"),
    ":": ("00000", "00100", "00100", "00000", "00100", "00100", "00000"),
    " ": ("00000",) * 7,
}


def word_width(text: str, scale: int) -> int:
    return max(0, len(text) * 6 * scale - scale)


def glyph_pixels(text: str, x: int, y: int, scale: int) -> set[tuple[int, int]]:
    pixels: set[tuple[int, int]] = set()
    cursor = x
    for char in text:
        rows = PIXEL_FONT[char]
        for row, bits in enumerate(rows):
            slant = (6 - row) // 3
            for column, bit in enumerate(bits):
                if bit != "1":
                    continue
                for py in range(scale):
                    for px in range(scale):
                        pixels.add((cursor + column * scale + px + slant, y + row * scale + py))
        cursor += 6 * scale
    return pixels


def paint_logo_text(image: Image.Image, text: str, y: int, scale: int) -> None:
    x = (image.width - word_width(text, scale)) // 2
    pixels = glyph_pixels(text, x, y, scale)
    access = image.load()
    for px, py in pixels:
        for oy in range(-2, 3):
            for ox in range(-2, 3):
                xx, yy = px + ox + 3, py + oy + 3
                if 0 <= xx < image.width and 0 <= yy < image.height and access[xx, yy] == 0:
                    access[xx, yy] = 2
    for px, py in pixels:
        for oy in range(-1, 2):
            for ox in range(-1, 2):
                xx, yy = px + ox, py + oy
                if 0 <= xx < image.width and 0 <= yy < image.height:
                    access[xx, yy] = 1
    min_y = min((py for _, py in pixels), default=y)
    max_y = max((py for _, py in pixels), default=y + 1)
    split = (min_y + max_y) // 2
    for px, py in pixels:
        if 0 <= px < image.width and 0 <= py < image.height:
            access[px, py] = 8 if py <= split else 6
            if (py - min_y) % max(2, scale * 2) == 0:
                access[px, py] = 15


def build_logo(primary: str, secondary: str) -> Image.Image:
    logo = Image.new("P", (256, 64), 0)
    primary_scale = 4 if len(primary) <= 8 else 3
    paint_logo_text(logo, primary, 3, primary_scale)
    paint_logo_text(logo, secondary, 39, 2)
    draw = ImageDraw.Draw(logo)
    draw.line((28, 59, 228, 59), fill=5, width=1)
    draw.line((44, 61, 212, 61), fill=10, width=1)
    for x in (18, 22, 234, 238):
        draw.line((x, 57, x + 12 if x < 128 else x - 12, 57), fill=6, width=1)
    return logo


def nearest_palette_index(rgb: tuple[int, int, int], palette: Sequence[tuple[int, int, int]]) -> int:
    best = 0
    best_distance = 1 << 62
    for index, color in enumerate(palette):
        dr = rgb[0] - color[0]
        dg = rgb[1] - color[1]
        db = rgb[2] - color[2]
        distance = dr * dr * 3 + dg * dg * 5 + db * db * 2
        if distance < best_distance:
            best_distance = distance
            best = index
    return best


def quantize_title(source: Image.Image) -> Image.Image:
    # Work at the Mega Drive output resolution. A small median pass removes
    # one-off color noise without creating enlarged nearest-neighbor pixels,
    # keeping the combined background + logo below the 64x32 VRAM tile budget.
    resized = ImageOps.fit(source.convert("RGB"), SCREEN_SIZE, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
    simplified = resized.filter(ImageFilter.MedianFilter(3))
    result = Image.new("P", SCREEN_SIZE, 0)
    src = simplified.load()
    dst = result.load()
    for y in range(result.height):
        for x in range(result.width):
            dst[x, y] = nearest_palette_index(src[x, y], TITLE_PALETTE)
    return result


def generic_title_background() -> Image.Image:
    image = Image.new("P", SCREEN_SIZE, 0)
    pixels = image.load()
    for y in range(224):
        for x in range(320):
            if y < 140:
                index = 1 + min(10, (y * 10) // 140)
            else:
                index = 2 + ((x + y * 2) & 3)
            pixels[x, y] = index
    draw = ImageDraw.Draw(image)
    draw.polygon(((24, 146), (78, 134), (116, 150), (80, 162)), fill=15)
    draw.polygon(((36, 146), (72, 140), (102, 150), (70, 156)), fill=14)
    draw.ellipse((48, 142, 62, 156), fill=6)
    draw.ellipse((164, 82, 326, 190), fill=6)
    draw.ellipse((188, 96, 330, 180), fill=1)
    draw.ellipse((196, 112, 212, 128), fill=10)
    draw.rectangle((232, 72, 300, 116), fill=7)
    draw.line((0, 181, 319, 181), fill=12, width=2)
    for y in range(186, 224, 8):
        draw.line((0, y, 319, y - 3), fill=14 if (y // 8) & 1 else 5, width=1)
    return image


def build_stages(destination: Path) -> list[str]:
    metrics: list[str] = []
    for index, builder in enumerate(STAGE_BUILDERS):
        width_a = STAGE_LENGTHS[index]
        width_b = math.ceil(width_a / (1 << STAGE_PARALLAX_SHIFTS[index])) + 320
        bg, fg = builder(width_b, width_a)
        palette = STAGE_PALETTES[index]
        save_indexed(bg.render(), palette, destination / f"stage{index + 1:02d}_bg_b.png")
        save_indexed(fg.render(), palette, destination / f"stage{index + 1:02d}_bg_a.png", transparent=True)
        metrics.append(f"stage {index + 1}: BG_B {bg.unique_patterns()} patterns / BG_A {fg.unique_patterns()} patterns")
    return metrics


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate 1:1-pixel horizontal STG tile backgrounds and title assets.")
    parser.add_argument("--title-source", type=Path, default=DEFAULT_TITLE_SOURCE)
    args = parser.parse_args()
    if not args.title_source.is_file():
        raise SystemExit(f"title source is missing: {args.title_source}")

    source = Image.open(args.title_source)
    title = quantize_title(source)
    geroneko_logo = build_logo("GERONEKO", "ABYSS STRIKE")
    generic_title = generic_title_background()
    generic_logo = build_logo("HORIZONTAL", "STG")

    metrics: list[str] = []
    for destination in (BUILDER_GFX, GERONEKO_GFX):
        metrics.extend(build_stages(destination))

    save_indexed(generic_title, TITLE_PALETTE, BUILDER_GFX / "title_background.png")
    save_indexed(generic_logo, LOGO_PALETTE, BUILDER_GFX / "title_logo.png", transparent=True)
    save_indexed(title, TITLE_PALETTE, GERONEKO_GFX / "title_background.png")
    save_indexed(geroneko_logo, LOGO_PALETTE, GERONEKO_GFX / "title_logo.png", transparent=True)

    print("Generated MD-density final-resolution 8x8 tile-composed stage art without nearest-neighbor upscaling.")
    for line in metrics[:5]:
        print(line)
    print(f"GERONEKO title source: {args.title_source}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
