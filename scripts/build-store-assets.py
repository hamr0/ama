#!/usr/bin/env python3
"""Build AMA store assets: extension icons + Chrome Web Store screenshots.

Run from repo root:  python3 scripts/build-store-assets.py [--screenshots <src_dir>]

Outputs (relative to repo root):
  chrome/icon{16,48,128}.png            extension icons
  firefox/icon{16,48,128}.png           extension icons (identical)
  store-assets/store-icon-{128,256,512}.png   store listing master
  store-assets/screenshot-N.png         padded 1280x800 caps (when --screenshots given)
"""
import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageFilter

FONT_BOLD = "/usr/share/fonts/jetbrains-mono-fonts/JetBrainsMono-Bold.otf"

# Tokyonight palette
BG     = (13, 14, 21, 255)        # #0d0e15
GREEN  = (158, 206, 106, 255)     # #9ece6a — > prompt
CYAN   = (125, 207, 255, 255)     # #7dcfff — ama + cursor

# Chrome Web Store screenshot size (must be one of 1280x800 / 640x400)
SCREENSHOT_SIZE = (1280, 800)


# ─── icons ───────────────────────────────────────────────────────────────────

def rounded_square(size, radius, fill):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(img).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=radius, fill=fill
    )
    return img


def render_icon(size: int) -> Image.Image:
    """16 -> "_>"  ;  48 / 128 / 256 / 512 -> ">ama" + cursor block."""
    radius = max(2, size // 8)
    img = rounded_square(size, radius, BG)
    draw = ImageDraw.Draw(img)

    if size <= 16:
        font_px = 12
        font = ImageFont.truetype(FONT_BOLD, font_px)
        bbox_g = draw.textbbox((0, 0), ">", font=font)
        bbox_c = draw.textbbox((0, 0), "_", font=font)
        wg = bbox_g[2] - bbox_g[0]
        wc = bbox_c[2] - bbox_c[0]
        h = max(bbox_g[3] - bbox_g[1], bbox_c[3] - bbox_c[1])
        x = (size - (wg + 1 + wc)) // 2 - bbox_g[0]
        y = (size - h) // 2 - bbox_g[1] - 1
        draw.text((x, y), ">", fill=GREEN, font=font)
        draw.text((x + wg + 1, y), "_", fill=CYAN, font=font)
        return img

    pad = size // 8
    inner_w = size - 2 * pad
    font_px = int(inner_w / 5 / 0.6)
    font = ImageFont.truetype(FONT_BOLD, font_px)

    name = "ama"
    bbox_n = draw.textbbox((0, 0), name, font=font)
    glyph_w = (bbox_n[2] - bbox_n[0]) // 3
    glyph_h = bbox_n[3] - bbox_n[1]
    bbox_g = draw.textbbox((0, 0), ">", font=font)
    w_gt = bbox_g[2] - bbox_g[0]
    w_name = bbox_n[2] - bbox_n[0]
    gap = max(2, font_px // 4)
    cur_w = max(3, glyph_w // 2)
    cur_h = int(glyph_h * 0.95)

    total_w = w_gt + gap + w_name + gap // 2 + cur_w
    x = (size - total_w) // 2 - bbox_g[0]
    y = (size - glyph_h) // 2 - bbox_g[1]

    # glow pass
    glow = Image.new("RGBA", img.size, (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.text((x, y), ">", fill=GREEN, font=font)
    gd.text((x + w_gt + gap, y), name, fill=CYAN, font=font)
    cx = x + w_gt + gap + w_name + gap // 2
    cy = y + bbox_g[1] + (glyph_h - cur_h)
    gd.rectangle((cx, cy, cx + cur_w, cy + cur_h), fill=CYAN)
    glow = glow.filter(ImageFilter.GaussianBlur(max(1, size // 32)))

    out = Image.alpha_composite(img, glow)
    draw = ImageDraw.Draw(out)
    draw.text((x, y), ">", fill=GREEN, font=font)
    draw.text((x + w_gt + gap, y), name, fill=CYAN, font=font)
    draw.rectangle((cx, cy, cx + cur_w, cy + cur_h), fill=CYAN)
    return out


def build_icons(root: Path) -> None:
    # Extension icons inside the unpacked extensions.
    # 96 is added specifically for Firefox's about:debugging panel, which
    # picks the 96-px source first when present.
    for s in (16, 48, 96, 128):
        icon = render_icon(s)
        for target in (root / "chrome", root / "firefox"):
            icon.save(target / f"icon{s}.png", "PNG", optimize=True)
            print(f"  wrote {target.name}/icon{s}.png ({s}x{s})")

    # Store listing masters (128 is the canonical store icon)
    for s in (128, 256, 512):
        icon = render_icon(s)
        out = root / "store-assets" / f"store-icon-{s}.png"
        icon.save(out, "PNG", optimize=True)
        print(f"  wrote store-assets/{out.name} ({s}x{s})")


# ─── screenshots ─────────────────────────────────────────────────────────────

def sample_bg(src: Image.Image) -> tuple:
    """Pick the dominant color of the extension panel.

    Skip top 80 px (likely host-browser sidebar chrome) and sample the leftmost
    column at mid-height — that's almost always the panel's bg.
    """
    px = src.convert("RGB").getpixel((0, min(src.height - 1, src.height // 2 + 40)))
    return px + (255,)


def frame_screenshot(src_path: Path, out_path: Path, target: tuple = SCREENSHOT_SIZE) -> None:
    src = Image.open(src_path).convert("RGBA")
    bg = sample_bg(src)
    canvas = Image.new("RGBA", target, bg)

    sw, sh = src.size
    tw, th = target
    # Reserve 20px breathing room top/bottom; scale proportionally to fit.
    max_h = th - 40
    if sh > max_h:
        scale = max_h / sh
        new_size = (int(sw * scale), int(sh * scale))
        src = src.resize(new_size, Image.LANCZOS)
        sw, sh = new_size

    x = (tw - sw) // 2
    y = (th - sh) // 2
    canvas.paste(src, (x, y), src)
    canvas.convert("RGB").save(out_path, "PNG", optimize=True)
    print(f"  wrote {out_path.relative_to(out_path.parents[2])}  bg={bg[:3]}  src={src.size}")


def build_screenshots(root: Path, sources: list[Path]) -> None:
    out_dir = root / "store-assets"
    # Clear out the old set
    for old in sorted(out_dir.glob("screenshot-*.png")):
        old.unlink()
        print(f"  removed {old.name}")
    for i, src in enumerate(sources, start=1):
        if not src.exists():
            print(f"  SKIP {src} (not found)")
            continue
        frame_screenshot(src, out_dir / f"screenshot-{i}.png")


# ─── main ────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--screenshots",
        action="append",
        default=[],
        help="Source screenshot paths (repeat the flag for each).",
    )
    parser.add_argument(
        "--skip-icons", action="store_true", help="Don't regenerate icons."
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    print(f"repo root: {root}")

    if not args.skip_icons:
        print("[icons]")
        build_icons(root)

    if args.screenshots:
        print("[screenshots]")
        build_screenshots(root, [Path(p).expanduser() for p in args.screenshots])


if __name__ == "__main__":
    main()
