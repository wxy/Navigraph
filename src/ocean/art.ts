interface SpriteSheet {
  image: HTMLImageElement;
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

async function loadImage(file: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.src = '../images/' + file;
  await image.decode();
  return image;
}

async function loadSheet(file: string, columns: number, rows: number): Promise<SpriteSheet> {
  const image = await loadImage(file);
  return { image, columns, cellWidth: image.naturalWidth / columns, cellHeight: image.naturalHeight / rows };
}

export async function loadOceanArt() {
  const [boats, marine, birds, celestial, islands, largeIslands, surface, towns, piers] = await Promise.all([
    loadSheet('ocean-boats.webp', 3, 3),
    loadSheet('ocean-marine.webp', 2, 2),
    loadSheet('ocean-birds.webp', 2, 2),
    loadSheet('ocean-celestial.webp', 2, 1),
    loadSheet('ocean-islands.webp', 3, 3),
    loadSheet('ocean-large-islands.webp', 2, 2),
    loadImage('ocean-water-tile.webp'),
    loadSheet('ocean-towns.webp', 2, 2),
    loadSheet('ocean-piers.webp', 2, 2),
  ]);
  return { boats, marine, birds, celestial, islands, largeIslands, surface, towns, piers };
}

export type OceanArt = Awaited<ReturnType<typeof loadOceanArt>>;

export function drawSprite(
  ctx: CanvasRenderingContext2D, sheet: SpriteSheet, index: number, x: number, y: number, width: number,
  height = width * sheet.cellHeight / sheet.cellWidth,
): void {
  const { image, columns, cellWidth, cellHeight } = sheet;
  ctx.drawImage(image,
    index % columns * cellWidth, Math.floor(index / columns) * cellHeight, cellWidth, cellHeight,
    x - width / 2, y - height / 2, width, height);
}
