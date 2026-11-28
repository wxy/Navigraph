import { drawSprite, type OceanArt } from './art.js';

function drawBackgroundSprite(
  ctx: CanvasRenderingContext2D, sheet: OceanArt['islands'], style: CSSStyleDeclaration,
  x: number, y: number, width: number, height: number,
): void {
  const rows = sheet.image.naturalHeight / sheet.cellHeight;
  const column = Math.round(Number.parseFloat(style.backgroundPositionX) * (sheet.columns - 1) / 100);
  const row = Math.round(Number.parseFloat(style.backgroundPositionY) * (rows - 1) / 100);
  ctx.filter = style.filter;
  drawSprite(ctx, sheet, row * sheet.columns + column, x + width / 2, y + height / 2, width, height);
  ctx.filter = 'none';
}

export function paintOceanImage(
  canvas: HTMLCanvasElement, map: HTMLElement, art: OceanArt, period: number, surfaceX: number, surfaceY: number,
): void {
  const bounds = map.getBoundingClientRect();
  const { width, height } = bounds;
  const pixels = Math.min(devicePixelRatio, 2);
  canvas.width = Math.round(width * pixels);
  canvas.height = Math.round(height * pixels);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(pixels, pixels);

  const box = (element: Element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x - bounds.x, y: rect.y - bounds.y, w: rect.width, h: rect.height };
  };
  const drawImage = (image: CanvasImageSource & Element) => {
    const { x, y, w, h } = box(image);
    ctx.drawImage(image, x, y, w, h);
  };

  ctx.fillStyle = getComputedStyle(map).backgroundColor;
  ctx.fillRect(0, 0, width, height);
  const surface = ctx.createPattern(art.surface, 'repeat')!;
  surface.setTransform(new DOMMatrix().translate(surfaceX, surfaceY)
    .scale(period / art.surface.naturalWidth, period / art.surface.naturalHeight));
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, width, height);

  map.querySelectorAll<HTMLImageElement>('.ocean-shallow-patch:not([hidden])').forEach(patch => {
    if (!patch.complete || !patch.naturalWidth) return;
    ctx.globalAlpha = Number(patch.style.opacity);
    drawImage(patch);
  });
  ctx.globalAlpha = 1;
  drawImage(map.querySelector<HTMLCanvasElement>('#ocean-water')!);

  const islands = Array.from(map.querySelectorAll<HTMLButtonElement>('.island:not([hidden])'));
  islands.sort((a, b) => (Number(getComputedStyle(a).zIndex) || 0) - (Number(getComputedStyle(b).zIndex) || 0));
  for (const island of islands) {
    ctx.globalAlpha = Number(island.style.opacity);
    const land = island.querySelector('.island-art')!;
    const { x, y, w, h } = box(land);
    ctx.save();
    ctx.beginPath();
    ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, 2 * Math.PI);
    ctx.clip();
    const sheet = island.classList.contains('major') ? art.largeIslands : art.islands;
    drawBackgroundSprite(ctx, sheet, getComputedStyle(land), x, y, w, h);
    ctx.restore();

    const town = island.querySelector('.island-town')!;
    const townBox = box(town);
    drawBackgroundSprite(ctx, art.towns, getComputedStyle(town), townBox.x, townBox.y, townBox.w, townBox.h);
    const windowLight = Number(getComputedStyle(town, '::after').opacity);
    if (windowLight) {
      ctx.save();
      ctx.globalAlpha *= windowLight;
      ctx.globalCompositeOperation = 'screen';
      for (const [offsetX, offsetY, color, tint] of [[.42, .51, '#ffc580b0', '#d88c3728'], [.58, .63, '#ffd7999c', '#d88c3720']] as const) {
        const cx = townBox.x + townBox.w * offsetX;
        const cy = townBox.y + townBox.h * offsetY;
        const radius = townBox.w * .22;
        const windows = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
        windows.addColorStop(0, color);
        windows.addColorStop(.55, tint);
        windows.addColorStop(1, 'transparent');
        ctx.fillStyle = windows;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.restore();
    }

    const label = island.querySelector('.island-label')!;
    const style = getComputedStyle(label);
    if (style.visibility === 'hidden') continue;
    const name = box(label);
    ctx.fillStyle = style.backgroundColor;
    ctx.beginPath();
    ctx.roundRect(name.x, name.y, name.w, name.h, Number.parseFloat(style.borderRadius));
    ctx.fill();
    ctx.textBaseline = 'middle';
    for (const line of Array.from(label.children)) {
      const { x, y, w, h } = box(line);
      const textStyle = getComputedStyle(line);
      ctx.font = `${textStyle.fontWeight} ${textStyle.fontSize} ${textStyle.fontFamily}`;
      ctx.fillStyle = textStyle.color;
      ctx.textAlign = 'center';
      let text = line.textContent!;
      if (ctx.measureText(text).width > w) {
        const letters = Array.from(text);
        do {
          letters.pop();
          text = letters.join('') + '…';
        } while (letters.length && ctx.measureText(text).width > w);
      }
      ctx.fillText(text, x + w / 2, y + h / 2, w);
    }
  }

  map.querySelectorAll<HTMLElement>('.ocean-island-piers:not([hidden]) .ocean-pier').forEach(pier => {
    const style = getComputedStyle(pier);
    const [ox, oy] = style.transformOrigin.split(' ').map(Number.parseFloat);
    const matrix = new DOMMatrix(style.transform);
    ctx.save();
    ctx.globalAlpha = Number(pier.parentElement!.style.opacity) * Number(style.opacity);
    ctx.translate(Number.parseFloat(style.left) + ox, Number.parseFloat(style.top) + oy);
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    drawBackgroundSprite(ctx, art.piers, style, -ox, -oy, Number.parseFloat(style.width), Number.parseFloat(style.height));
    ctx.restore();
  });

  const light = getComputedStyle(map.querySelector('#ocean-light')!);
  ctx.globalAlpha = Number(light.opacity);
  if (ctx.globalAlpha > 0) {
    const angle = Number.parseFloat(light.getPropertyValue('--tint-angle')) * Math.PI / 180;
    const length = Math.abs(Math.sin(angle) * width) + Math.abs(Math.cos(angle) * height);
    const dx = Math.sin(angle) * length / 2, dy = -Math.cos(angle) * length / 2;
    const tint = ctx.createLinearGradient(width / 2 - dx, height / 2 - dy, width / 2 + dx, height / 2 + dy);
    tint.addColorStop(0, light.getPropertyValue('--tint-start').trim());
    tint.addColorStop(1, light.getPropertyValue('--tint-end').trim());
    ctx.fillStyle = tint;
    ctx.fillRect(0, 0, width, height);
  }

  const sky = map.querySelector('#ocean-sky')!;
  const skyBox = box(sky);
  for (const pseudo of ['::before', '::after']) {
    const glow = getComputedStyle(sky, pseudo);
    const x = skyBox.x + Number.parseFloat(glow.left);
    const y = skyBox.y + Number.parseFloat(glow.top);
    const radius = Number.parseFloat(glow.width) * Math.SQRT1_2;
    const color = glow.getPropertyValue('--sky-glow-color').trim();
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `rgb(${color} / .34)`);
    gradient.addColorStop(.39, `rgb(${color} / .13)`);
    gradient.addColorStop(.71, `rgb(${color} / 0)`);
    ctx.globalAlpha = Number(glow.opacity);
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
  const sun = map.querySelector('#ocean-sun')!;
  const sunStyle = getComputedStyle(sun);
  const sunBox = box(sun);
  ctx.globalAlpha = Number(sunStyle.opacity);
  drawBackgroundSprite(ctx, art.celestial, sunStyle, sunBox.x, sunBox.y, sunBox.w, sunBox.h);
  const moon = map.querySelector<HTMLCanvasElement>('#ocean-moon')!;
  ctx.globalAlpha = Number(getComputedStyle(moon).opacity);
  drawImage(moon);

  ctx.globalAlpha = 1;
  drawImage(map.querySelector<HTMLCanvasElement>('#ocean-ships')!);
  drawImage(map.querySelector<HTMLCanvasElement>('#ocean-nameplate')!);
  const wind = map.querySelector<HTMLImageElement>('#ocean-wind')!;
  if (wind.complete && wind.naturalWidth) {
    const { x, y, w, h } = box(wind);
    const style = getComputedStyle(wind);
    ctx.translate(x + w / 2, y + h / 2);
    ctx.rotate(Number.parseFloat(style.rotate) * Math.PI / 180);
    ctx.filter = style.filter;
    ctx.drawImage(wind, -wind.width / 2, -wind.height / 2, wind.width, wind.height);
  }
}
