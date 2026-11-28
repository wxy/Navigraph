const FONT = '29px UnifrakturMaguntia, Georgia, serif';
export const nameplateFont = '29px UnifrakturMaguntia';

const frame = new Path2D('M 15 25 H 92 C 116 25 132 16 144 6 C 156 16 172 25 196 25 H 273 L 281 33 V 89 L 273 97 H 15 L 7 89 V 33 Z');

export function paintNameplate(canvas: HTMLCanvasElement, title: string, date: string): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.clearRect(0, 0, 288, 105);
  const brass = ctx.createLinearGradient(4, 6, 284, 97);
  brass.addColorStop(0, '#9e7741');
  brass.addColorStop(.42, '#ebce93');
  brass.addColorStop(.70, '#c89654');
  brass.addColorStop(1, '#8b643e');
  const body = ctx.createLinearGradient(0, 10, 0, 100);
  body.addColorStop(0, '#183739e8');
  body.addColorStop(1, '#061824e0');
  ctx.shadowColor = '#020c15aa';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = body;
  ctx.fill(frame);
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = brass;
  ctx.lineWidth = 1.1;
  ctx.stroke(frame);

  ctx.save();
  ctx.translate(144, 53);
  ctx.scale(.969, .903);
  ctx.translate(-144, -53);
  ctx.globalAlpha = .55;
  ctx.lineWidth = .7;
  ctx.stroke(frame);
  ctx.restore();

  ctx.strokeStyle = '#bc965c94';
  ctx.lineWidth = .7;
  ctx.beginPath();
  ctx.moveTo(33, 56);
  ctx.lineTo(121, 56);
  ctx.moveTo(167, 56);
  ctx.lineTo(255, 56);
  ctx.stroke();
  ctx.fillStyle = brass;
  ctx.fill(new Path2D('M 144 53 L 148 56 L 144 59 L 140 56 Z M 127 55 L 128 56 L 127 57 L 126 56 Z M 161 55 L 162 56 L 161 57 L 160 56 Z'));

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffe4ab';
  ctx.font = FONT;
  ctx.fillText('Navigraph', 144, 39);
  ctx.fillStyle = '#f9ebd0';
  ctx.font = '600 13px Georgia, "Songti SC", serif';
  ctx.fillText(title, 144, 69, 246);
  ctx.fillStyle = '#ddc59b';
  ctx.font = '11px Georgia, "Songti SC", serif';
  ctx.fillText(date, 144, 84, 246);
}
