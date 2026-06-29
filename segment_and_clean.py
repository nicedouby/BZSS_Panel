import os
from PIL import Image, ImageDraw

def flood_fill_background(img, tolerance=25):
    img = img.convert("RGBA")
    width, height = img.size
    filled = img.copy()
    
    bg_color = (0, 0, 0, 0)
    # Corners
    seeds = [(0, 0), (width - 1, 0), (0, height - 1), (width - 1, height - 1)]
    # Edges midpoints
    seeds += [(width // 2, 0), (width // 2, height - 1), (0, height // 2), (width - 1, height // 2)]
    # Edge lines to ensure full background flood fill
    for x in range(0, width, 50):
        seeds.append((x, 0))
        seeds.append((x, height - 1))
    for y in range(0, height, 50):
        seeds.append((0, y))
        seeds.append((width - 1, y))
        
    for seed in seeds:
        current_pixel = filled.getpixel(seed)
        if current_pixel[3] == 0:
            continue
        ImageDraw.floodfill(filled, seed, bg_color, thresh=tolerance)
    return filled

def segment_image(img_path):
    img = Image.open(img_path)
    filled = flood_fill_background(img)
    w, h = filled.size
    
    # Analyze active columns (where alpha > 0)
    alpha = filled.split()[-1]
    try:
        alpha_data = alpha.get_flattened_data()
    except AttributeError:
        alpha_data = list(alpha.getdata())
        
    col_active = [False] * w
    for x in range(w):
        for y in range(h):
            if alpha_data[y * w + x] > 0:
                col_active[x] = True
                break
                
    segments = []
    in_seg = False
    start = 0
    for x in range(w):
        if col_active[x] and not in_seg:
            start = x
            in_seg = True
        elif not col_active[x] and in_seg:
            if x - start > 20: # ignore very thin lines
                segments.append((start, x))
            in_seg = False
    if in_seg:
        segments.append((start, w))
        
    chars = []
    for x1, x2 in segments:
        col_crop = filled.crop((x1, 0, x2, h))
        col_alpha = col_crop.split()[-1]
        bbox = col_alpha.getbbox()
        if bbox:
            y1, y2 = bbox[1], bbox[3]
            char_crop = filled.crop((x1, y1, x2, y2))
            chars.append(char_crop)
    return chars

image_dir = r"D:\BZSS_Panel\鼠鼠姬形象"
output_dir = os.path.join(image_dir, "整理_透明背景")
os.makedirs(output_dir, exist_ok=True)

files = [f for f in os.listdir(image_dir) if f.lower().endswith(('.png', '.jpg', '.jpeg'))]

print("Starting segmentation process...")
count = 0

# Mapping of file prefix to descriptive name
theme_map = {
    "108947be": "casual",
    "295edd41": "tactical",
    "3eec3a98": "summer",
    "690f2906": "tactical",
    "7a8130cb": "roomwear",
    "c144ad60": "school",
    "d5137357": "cozy",
    "f99c6a0b": "school_summer"
}

for f in sorted(files):
    prefix = f.split('-')[0]
    theme_name = theme_map.get(prefix, "char")
    path = os.path.join(image_dir, f)
    chars = segment_image(path)
    
    print(f"Processing {f} ({theme_name}): found {len(chars)} characters.")
    for idx, c in enumerate(chars):
        out_name = f"{theme_name}_{idx + 1:02d}.png"
        out_path = os.path.join(output_dir, out_name)
        
        # Ensure we don't overwrite if files from different source images get same prefix (e.g. tactical)
        # We can append prefix if there's a collision
        if os.path.exists(out_path):
            out_name = f"{theme_name}_{prefix}_{idx + 1:02d}.png"
            out_path = os.path.join(output_dir, out_name)
            
        c.save(out_path, "PNG")
        print(f"  Saved to: {out_name}")
        count += 1

print(f"\nSuccessfully finished! Total {count} characters segmented and saved to:")
print(f"  {output_dir}")
