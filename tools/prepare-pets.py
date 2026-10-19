"""Prepare PW4 A2 animation frames from the user's local pet atlases."""
import json
import re
from pathlib import Path

from PIL import Image


BASE = Path(__file__).resolve().parents[1] / 'kindle/extensions/kindle-desk'
FRAME_COUNTS = (6, 8, 8, 4, 5, 8, 6, 6, 6)
FRAME_SIZE = (210, 227)
GAMMA = 1.2


def prepare_frames(manifest_path, output):
    manifest_path, output = Path(manifest_path), Path(output)
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    seen = set()
    count = 0
    lut = [round(255 * (value / 255) ** GAMMA) for value in range(256)]
    for pet in manifest.values():
        source = (manifest_path.parent.parent / pet['url']).resolve()
        if source in seen:
            continue
        seen.add(source)
        if not re.fullmatch(r'[a-zA-Z0-9_-]+', source.stem):
            raise ValueError('Pet PNG filenames must use letters, numbers, hyphens or underscores.')
        rows = pet['rows']
        if rows not in (9, 11) or pet.get('columns', 8) != 8:
            raise ValueError('Expected an 8-column Pet v1 or v2 atlas (9 or 11 rows).')
        with Image.open(source) as image:
            if image.size != (1536, rows * 208):
                raise ValueError('Expected 192 x 208 pixel cells: ' + source.name)
            atlas = image.convert('RGBA')
        target = output / source.stem
        target.mkdir(parents=True, exist_ok=True)
        for row, frames in enumerate(FRAME_COUNTS):
            for frame in range(frames):
                cell = atlas.crop((frame * 192, row * 208, (frame + 1) * 192, (row + 1) * 208))
                white = Image.new('RGBA', cell.size, 'white')
                white.alpha_composite(cell)
                gray = white.convert('L').resize(FRAME_SIZE, Image.Resampling.LANCZOS).point(lut)
                gray.convert('1', dither=Image.Dither.FLOYDSTEINBERG).save(target / f'{row}-{frame}.png')
                count += 1
    return count


if __name__ == '__main__':
    count = prepare_frames(BASE / 'app/pets/manifest.json', BASE / 'native-frames-fs-dark')
    print(f'Prepared {count} A2 frames in {BASE / "native-frames-fs-dark"}')
