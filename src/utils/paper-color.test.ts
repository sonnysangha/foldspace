import { expect, it } from 'vitest';
import { paperColor } from './paper-color';
const luminance = (hex: string) => [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
it('keeps small body text readable on preset and dark custom papers', () => {
  for (const color of ['#FFF1B9', '#F5DAD1', '#DDE9DD', '#DCE8F2', '#E8DFF1', '#FFFFFF', '#000000', '#120038', '#FF0000', '#002211']) {
    expect((luminance(paperColor(color)) + 0.05) / (luminance('#51594B') + 0.05)).toBeGreaterThanOrEqual(4.5);
  }
});
