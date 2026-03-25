#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageOps


@dataclass(frozen=True)
class Box:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def width(self) -> int:
        return self.right - self.left + 1

    @property
    def height(self) -> int:
        return self.bottom - self.top + 1

    def padded(self, amount: int, max_width: int, max_height: int) -> "Box":
        return Box(
            left=max(0, self.left - amount),
            top=max(0, self.top - amount),
            right=min(max_width - 1, self.right + amount),
            bottom=min(max_height - 1, self.bottom + amount),
        )


def find_components(mask: Image.Image, min_area: int, max_y: int | None = None) -> list[Box]:
    width, height = mask.size
    px = mask.load()
    seen = [[False] * width for _ in range(height)]
    boxes: list[Box] = []

    for y in range(height):
        for x in range(width):
            if seen[y][x] or px[x, y] == 0:
                continue
            queue = deque([(x, y)])
            seen[y][x] = True
            area = 0
            min_x = max_x = x
            min_y = max_y_component = y

            while queue:
                current_x, current_y = queue.popleft()
                area += 1
                min_x = min(min_x, current_x)
                max_x = max(max_x, current_x)
                min_y = min(min_y, current_y)
                max_y_component = max(max_y_component, current_y)
                for next_x, next_y in (
                    (current_x + 1, current_y),
                    (current_x - 1, current_y),
                    (current_x, current_y + 1),
                    (current_x, current_y - 1),
                ):
                    if 0 <= next_x < width and 0 <= next_y < height and not seen[next_y][next_x] and px[next_x, next_y] > 0:
                        seen[next_y][next_x] = True
                        queue.append((next_x, next_y))

            if area < min_area:
                continue
            if max_y is not None and min_y > max_y:
                continue
            boxes.append(Box(min_x, min_y, max_x, max_y_component))
    return boxes


def union_boxes(boxes: list[Box]) -> Box:
    return Box(
        left=min(box.left for box in boxes),
        top=min(box.top for box in boxes),
        right=max(box.right for box in boxes),
        bottom=max(box.bottom for box in boxes),
    )


def build_alpha_mask(image: Image.Image) -> Image.Image:
    grayscale = image.convert("L")
    alpha = grayscale.point(
        lambda value: 0 if value >= 230 else (255 if value <= 150 else int((230 - value) * 255 / 80))
    )
    return alpha.filter(ImageFilter.GaussianBlur(radius=0.65))


def extract_mark(image: Image.Image) -> Image.Image:
    alpha = build_alpha_mask(image)
    grayscale = image.convert("L")
    gray_fill = grayscale.point(
        lambda value: 18 if value <= 28 else (126 if value >= 190 else int(18 + (value - 28) * 108 / 162))
    )
    mark = Image.merge("RGBA", (gray_fill, gray_fill, gray_fill, alpha))
    return trim_to_alpha(mark)


def trim_to_alpha(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if not bbox:
        return image
    return image.crop(bbox)


def fit_center(image: Image.Image, size: tuple[int, int], inset_ratio: float = 0.14) -> Image.Image:
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    max_width = int(size[0] * (1 - inset_ratio * 2))
    max_height = int(size[1] * (1 - inset_ratio * 2))
    fitted = ImageOps.contain(image, (max_width, max_height), Image.Resampling.LANCZOS)
    left = (size[0] - fitted.width) // 2
    top = (size[1] - fitted.height) // 2
    canvas.alpha_composite(fitted, (left, top))
    return canvas


def build_icon_background(size: int) -> Image.Image:
    background = Image.new("RGBA", (size, size), (246, 244, 239, 255))
    pixels = background.load()
    center_x = size / 2
    center_y = size / 2
    max_distance = (center_x**2 + center_y**2) ** 0.5

    for y in range(size):
        for x in range(size):
            distance = ((x - center_x) ** 2 + (y - center_y) ** 2) ** 0.5
            ratio = min(1.0, distance / max_distance)
            shade = int(248 - ratio * 16)
            pixels[x, y] = (shade, shade - 1, shade - 4, 255)

    rounded_mask = Image.new("L", (size, size), 0)
    draw = ImageDraw.Draw(rounded_mask)
    radius = int(size * 0.23)
    draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    background.putalpha(rounded_mask)

    stroke = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw_stroke = ImageDraw.Draw(stroke)
    draw_stroke.rounded_rectangle(
        (2, 2, size - 3, size - 3),
        radius=radius,
        outline=(206, 202, 194, 255),
        width=max(2, size // 128),
    )
    background.alpha_composite(stroke)
    return background


def build_dark_logo_background(size: int) -> Image.Image:
    background = Image.new("RGBA", (size, size), (11, 18, 32, 255))
    pixels = background.load()
    center_x = size / 2
    center_y = size / 2
    max_distance = (center_x**2 + center_y**2) ** 0.5

    for y in range(size):
        for x in range(size):
            distance = ((x - center_x) ** 2 + (y - center_y) ** 2) ** 0.5
            ratio = min(1.0, distance / max_distance)
            r = int(13 + ratio * 8)
            g = int(21 + ratio * 11)
            b = int(38 + ratio * 20)
            pixels[x, y] = (r, g, b, 255)

    return background


def make_dark_variant(mark: Image.Image) -> Image.Image:
    alpha = mark.getchannel("A")
    gray = mark.convert("L")
    light_fill = gray.point(
        lambda value: 242 if value <= 28 else (178 if value >= 190 else int(242 - (value - 28) * 64 / 162))
    )
    dark_variant = Image.merge("RGBA", (light_fill, light_fill, light_fill, alpha))
    return trim_to_alpha(dark_variant)


def create_embedded_svg(png_path: Path, svg_path: Path) -> None:
    encoded = base64.b64encode(png_path.read_bytes()).decode("ascii")
    svg_path.write_text(
        "\n".join(
            [
                '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">',
                f'  <image href="data:image/png;base64,{encoded}" width="256" height="256"/>',
                "</svg>",
            ]
        ),
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()

    repo_root = args.repo_root
    public_dir = repo_root / "public"
    generated_dir = repo_root / "src-tauri" / "icons" / "_generated"
    public_dir.mkdir(parents=True, exist_ok=True)
    generated_dir.mkdir(parents=True, exist_ok=True)

    source = Image.open(args.input).convert("RGBA")
    grayscale = source.convert("L")
    dark_mask = grayscale.point(lambda value: 255 if value < 210 else 0)

    full_logo_components = find_components(dark_mask, min_area=1200, max_y=int(source.height * 0.86))
    full_logo_box = union_boxes(full_logo_components).padded(48, source.width, source.height)
    full_logo_crop = source.crop((full_logo_box.left, full_logo_box.top, full_logo_box.right + 1, full_logo_box.bottom + 1))
    full_logo = extract_mark(full_logo_crop)
    full_logo_dark = make_dark_variant(full_logo)

    monogram_components = [
        box for box in full_logo_components
        if box.left < int(source.width * 0.58)
    ]
    monogram_box = union_boxes(monogram_components).padded(40, source.width, source.height)
    monogram_crop = source.crop((monogram_box.left, monogram_box.top, monogram_box.right + 1, monogram_box.bottom + 1))
    monogram = extract_mark(monogram_crop)

    logo_art = fit_center(full_logo, (1024, 1024), inset_ratio=0.08)
    logo_art.save(public_dir / "logo-fnc-art.png")
    dark_logo = build_dark_logo_background(1024)
    dark_logo_shadow = Image.new("RGBA", full_logo_dark.size, (0, 0, 0, 0))
    dark_shadow_mask = full_logo_dark.getchannel("A").filter(ImageFilter.GaussianBlur(radius=9))
    dark_logo_shadow.putalpha(dark_shadow_mask.point(lambda value: min(86, value // 4)))
    dark_logo_foreground = fit_center(full_logo_dark, (920, 920), inset_ratio=0.06)
    dark_logo_shadow_fitted = fit_center(dark_logo_shadow, (920, 920), inset_ratio=0.06)
    dark_logo.alpha_composite(
        dark_logo_shadow_fitted,
        ((dark_logo.width - dark_logo_shadow_fitted.width) // 2, (dark_logo.height - dark_logo_shadow_fitted.height) // 2 + 14),
    )
    dark_logo.alpha_composite(
        dark_logo_foreground,
        ((dark_logo.width - dark_logo_foreground.width) // 2, (dark_logo.height - dark_logo_foreground.height) // 2),
    )
    dark_logo.save(public_dir / "logo-fnc-art-dark.png")

    app_icon_base = build_icon_background(1024)
    monogram_shadow = Image.new("RGBA", monogram.size, (0, 0, 0, 0))
    shadow_mask = monogram.getchannel("A").filter(ImageFilter.GaussianBlur(radius=10))
    monogram_shadow.putalpha(shadow_mask.point(lambda value: min(120, value // 3)))
    icon_foreground = fit_center(monogram, (860, 860), inset_ratio=0.035)
    icon_shadow = fit_center(monogram_shadow, (860, 860), inset_ratio=0.035)
    shadow_layer = Image.new("RGBA", app_icon_base.size, (0, 0, 0, 0))
    shadow_layer.alpha_composite(icon_shadow, ((app_icon_base.width - icon_shadow.width) // 2, (app_icon_base.height - icon_shadow.height) // 2 + 18))
    app_icon_base.alpha_composite(shadow_layer)
    app_icon_base.alpha_composite(icon_foreground, ((app_icon_base.width - icon_foreground.width) // 2, (app_icon_base.height - icon_foreground.height) // 2))

    app_icon_source = generated_dir / "app-icon-source.png"
    app_icon_base.save(app_icon_source)

    favicon_png = public_dir / "favicon.png"
    app_icon_base.resize((256, 256), Image.Resampling.LANCZOS).save(favicon_png)
    create_embedded_svg(favicon_png, public_dir / "favicon.svg")

    icons_svg = repo_root / "public" / "icons.svg"
    create_embedded_svg(favicon_png, icons_svg)

    print(f"logo:{public_dir / 'logo-fnc-art.png'}")
    print(f"icon:{app_icon_source}")


if __name__ == "__main__":
    main()
