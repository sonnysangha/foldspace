/** Keep supplied paper hues while ensuring dark custom colors remain readable. */
export function paperColor(color: string) {
  if (!/^#[a-f\d]{6}$/i.test(color)) return '#FFFEFA';
  const channels = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const lightness = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  const white = Math.max(0.3, Math.min(0.8, (205 - lightness) / (255 - lightness || 1)));
  return `#${channels.map(channel => Math.round(channel * (1 - white) + 255 * white).toString(16).padStart(2, '0')).join('')}`;
}
