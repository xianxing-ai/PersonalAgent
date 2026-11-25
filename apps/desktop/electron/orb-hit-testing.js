/** The largest centered circle keeps the painted core and its surrounding
 * particles inside the native region while exposing the four corners. Electron
 * takes window-relative DIPs and builds the Windows region at the current DPI. */
export function orbShapeRects(width, height) {
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = Math.min(centerX, centerY);
  const rects = [];
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - centerY;
    if (Math.abs(dy) >= radius) continue;
    const halfWidth = Math.sqrt(radius * radius - dy * dy);
    const left = Math.ceil(centerX - halfWidth - 0.5);
    const right = Math.floor(centerX + halfWidth - 0.5) + 1;
    if (right > left) rects.push({x: left, y, width: right - left, height: 1});
  }
  return rects;
}
