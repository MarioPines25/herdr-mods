// GitHub label colors are six hex digits without '#'. Keep arbitrary API values
// out of native color parsing, and choose readable ink for the solid pill.
export function labelColors(value) {
  const hex = typeof value === 'string' && /^[\da-f]{6}$/i.test(value) ? value : 'ededed';
  const rgb = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = rgb.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return { background: `#${hex}`, border: `#${hex}`, foreground: luminance > 0.179 ? '#000000' : '#ffffff' };
}
