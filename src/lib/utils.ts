/** Convert hex color string (#RRGGBB) to normalized [r, g, b] tuple (0-1 range). */
export function hexToColor(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

/** Strip HTML tags to get plain text. */
export function htmlToPlainText(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.innerText;
}
