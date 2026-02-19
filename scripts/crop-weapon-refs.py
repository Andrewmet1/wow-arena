#!/usr/bin/env python3
"""
Crop weapon reference images from class splash art for Meshy Image-to-3D.

Each crop region is manually defined based on where the weapon appears
in the 1024x1792 splash art. The cropped image is placed on a plain
dark background to help Image-to-3D isolate the subject.

Output: public/assets/art/wpn_{class}_{type}_ref.png
"""

from PIL import Image, ImageFilter, ImageDraw
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ART_DIR = os.path.join(ROOT, 'public', 'assets', 'art')

# (x, y, x2, y2) crop box — coordinates in 1024x1792 splash images
CROP_REGIONS = {
    'revenant': {
        'mace': (50, 280, 500, 950),     # sword/mace in upper-left
        'shield': (300, 650, 950, 1350),  # ornate shield center-right
    },
    'tyrant': {
        'greatsword': (200, 850, 720, 1650),  # greatsword lower-center
    },
    'wraith': {
        'daggers': (0, 850, 1024, 1400),      # both daggers at hip level
    },
    'infernal': {
        'staff': (580, 150, 1024, 1150),      # fire staff right side
    },
    'harbinger': {
        'staff': (150, 680, 850, 1250),       # grimoire/staff center
    },
}

# Target output size for Meshy (square, reasonable resolution)
OUTPUT_SIZE = 1024

def crop_weapon_ref(class_id, weapon_type, box):
    splash_path = os.path.join(ART_DIR, f'{class_id}_splash.png')
    if not os.path.exists(splash_path):
        print(f'  SKIP: {splash_path} not found')
        return False

    img = Image.open(splash_path)

    # Crop the weapon region
    cropped = img.crop(box)
    w, h = cropped.size

    # Place on a dark neutral background (square)
    dim = max(w, h)
    # Add some padding
    canvas_size = int(dim * 1.15)
    canvas = Image.new('RGB', (canvas_size, canvas_size), (30, 30, 35))

    # Center the crop on the canvas
    paste_x = (canvas_size - w) // 2
    paste_y = (canvas_size - h) // 2
    canvas.paste(cropped, (paste_x, paste_y))

    # Resize to output size
    canvas = canvas.resize((OUTPUT_SIZE, OUTPUT_SIZE), Image.LANCZOS)

    out_path = os.path.join(ART_DIR, f'wpn_{class_id}_{weapon_type}_ref.png')
    canvas.save(out_path, 'PNG')
    print(f'  OK: {os.path.basename(out_path)} ({w}x{h} crop → {OUTPUT_SIZE}x{OUTPUT_SIZE})')
    return True


def main():
    print('Cropping weapon references from splash art...\n')

    total = 0
    success = 0

    for class_id, weapons in CROP_REGIONS.items():
        print(f'{class_id.upper()}:')
        for weapon_type, box in weapons.items():
            total += 1
            if crop_weapon_ref(class_id, weapon_type, box):
                success += 1

    print(f'\nDone: {success}/{total} weapon references created')
    print(f'Output dir: {ART_DIR}')


if __name__ == '__main__':
    main()
