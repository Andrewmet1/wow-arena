#!/usr/bin/env python3
"""
Remove weapons from model_ref images by painting over weapon regions
with blurred/sampled background colors. This creates clean reference
images for Meshy Image-to-3D so character models generate without
baked-in weapon geometry.

Output: public/assets/art/{class}_model_ref_noweapons.png
"""

from PIL import Image, ImageFilter, ImageDraw
import numpy as np
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, 'public', 'assets', 'art')

# Weapon regions to paint over in each 1024x1792 model_ref image.
# Each entry is a list of (x1, y1, x2, y2) rectangles covering weapon areas.
# We'll fill these with heavily blurred background from the surrounding area.
WEAPON_REGIONS = {
    'tyrant': [
        # The concept sheet has a massive greatsword in the front-center
        # Main blade running diagonally from lower-left to upper-right
        (200, 600, 550, 1500),   # Main greatsword blade area (front view)
        # Small weapon reference at bottom-right
        (700, 1400, 900, 1750),  # Small sword reference view
        # Sword handle/crossguard area bottom of front view
        (350, 1300, 600, 1550),
    ],
    'wraith': [
        # Two daggers held at sides, visible at hip level
        (50, 800, 250, 1150),    # Left dagger
        (750, 800, 1000, 1150),  # Right dagger
    ],
    'infernal': [
        # Fire staffs flanking on both sides
        (0, 0, 300, 1600),       # Left staff
        (720, 0, 1024, 1600),    # Right staff
        # Small staff reference at bottom
        (400, 1500, 700, 1792),
    ],
    'harbinger': [
        # Glowing grimoire held in left hand
        (500, 750, 850, 1050),   # Book/grimoire in left hand
        # Tail/bone weapon at bottom
        (200, 1200, 550, 1550),
    ],
    'revenant': [
        # Revenant model_ref is mostly clean (armor only), minimal weapon removal needed
        # Small items at the waist/hands
    ],
}


def sample_background_color(img, region, margin=30):
    """Sample average color from around a region (outside the region bounds)."""
    x1, y1, x2, y2 = region
    w, h = img.size
    pixels = []

    # Sample from strips around the region
    for dx in range(-margin, (x2 - x1) + margin, 5):
        for side_y in [y1 - margin, y2 + margin]:
            sx = max(0, min(w - 1, x1 + dx))
            sy = max(0, min(h - 1, side_y))
            pixels.append(img.getpixel((sx, sy)))

    for dy in range(-margin, (y2 - y1) + margin, 5):
        for side_x in [x1 - margin, x2 + margin]:
            sx = max(0, min(w - 1, side_x))
            sy = max(0, min(h - 1, y1 + dy))
            pixels.append(img.getpixel((sx, sy)))

    if not pixels:
        return (40, 40, 45)

    # Average color
    r = sum(p[0] for p in pixels) // len(pixels)
    g = sum(p[1] for p in pixels) // len(pixels)
    b = sum(p[2] for p in pixels) // len(pixels)
    return (r, g, b)


def paint_over_region(img, region, feather=40):
    """Paint over a region with blurred surrounding content for seamless blending."""
    x1, y1, x2, y2 = region
    w, h = img.size

    # Clamp to image bounds
    x1 = max(0, x1)
    y1 = max(0, y1)
    x2 = min(w, x2)
    y2 = min(h, y2)

    # Create a copy for the blurred fill source
    # Use a large Gaussian blur of the original image
    blurred = img.filter(ImageFilter.GaussianBlur(radius=60))

    # Create a mask for smooth blending
    mask = Image.new('L', (w, h), 0)
    draw = ImageDraw.Draw(mask)

    # Draw the core region fully opaque
    inner_x1 = x1 + feather
    inner_y1 = y1 + feather
    inner_x2 = x2 - feather
    inner_y2 = y2 - feather

    if inner_x2 > inner_x1 and inner_y2 > inner_y1:
        draw.rectangle([inner_x1, inner_y1, inner_x2, inner_y2], fill=255)

    # Draw the full region and blur the mask for feathering
    draw.rectangle([x1, y1, x2, y2], fill=200)
    mask = mask.filter(ImageFilter.GaussianBlur(radius=feather))

    # Composite: blend blurred version over original using the mask
    img = Image.composite(blurred, img, mask)
    return img


def remove_weapons(class_id):
    """Remove weapons from a class model_ref image."""
    src_path = os.path.join(ART_DIR, f'{class_id}_model_ref.png')
    if not os.path.exists(src_path):
        print(f'  SKIP: {src_path} not found')
        return False

    regions = WEAPON_REGIONS.get(class_id, [])
    if not regions:
        # Just copy the original
        img = Image.open(src_path)
        out_path = os.path.join(ART_DIR, f'{class_id}_model_ref_noweapons.png')
        img.save(out_path, 'PNG')
        print(f'  OK: {os.path.basename(out_path)} (no weapon regions defined, copied original)')
        return True

    img = Image.open(src_path).convert('RGB')
    print(f'  Source: {os.path.basename(src_path)} ({img.size[0]}x{img.size[1]})')
    print(f'  Removing {len(regions)} weapon region(s)...')

    for i, region in enumerate(regions):
        img = paint_over_region(img, region, feather=35)
        print(f'    Region {i + 1}: ({region[0]},{region[1]}) → ({region[2]},{region[3]})')

    out_path = os.path.join(ART_DIR, f'{class_id}_model_ref_noweapons.png')
    img.save(out_path, 'PNG')
    print(f'  OK: {os.path.basename(out_path)}')
    return True


def main():
    print('Removing weapons from model_ref images...\n')

    total = 0
    success = 0

    for class_id in WEAPON_REGIONS:
        print(f'{class_id.upper()}:')
        total += 1
        if remove_weapons(class_id):
            success += 1

    print(f'\nDone: {success}/{total} weaponless refs created')
    print(f'Output dir: {ART_DIR}')


if __name__ == '__main__':
    main()
