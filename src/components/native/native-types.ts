import type { ReactNode, Ref } from 'react';

import type { CardKind } from '@/types/canvas';

export type DuoLayoutProps = {
  primary: ReactNode;
  secondary: ReactNode;
  wide: boolean;
  showSecondary: boolean;
  /** The second pane's background. It also fills the gap the system leaves at the hinge. */
  secondaryColor?: string;
};

export type CardEditorProps = {
  editorRef?: Ref<{ blur: () => void }>;
  autoFocus?: boolean;
  imageUrl?: string | null;
  title: string;
  body: string;
  color: string;
  onTitleChange: (value: string) => void;
  onBodyChange: (value: string) => void;
  kind: CardKind;
  /** The web address of a link card. */
  url?: string;
  /** Set for a space: steps into its canvas. */
  onOpenCanvas?: () => void;
  onOpenLink?: () => void;
  /** Content specific to the card's kind, shown under the title: checklist items, a player, a map. */
  renderExtra?: (width: number) => ReactNode;
};

export type DrawingControlsProps = {
  color: string;
  width: number;
  onColorChange: (value: string) => void;
  onWidthChange: (value: number) => void;
};

/** The three card sizes, smallest first. */
export const CARD_SIZES = [
  { label: 'Small', short: 'S', width: 220, height: 170 },
  { label: 'Medium', short: 'M', width: 280, height: 240 },
  { label: 'Large', short: 'L', width: 380, height: 300 },
] as const;

export const PAPER_COLORS = [
  { label: 'White', value: '#FFFFFF' },
  { label: 'Yellow', value: '#FFF2B2' },
  { label: 'Green', value: '#DBEEDC' },
  { label: 'Blue', value: '#E0EDFA' },
  { label: 'Violet', value: '#EFEAFF' },
  { label: 'Pink', value: '#FFE2D8' },
];

export const INK_COLORS = [
  { label: 'Black', value: '#141414' },
  { label: 'Violet', value: '#5342D6' },
  { label: 'Blue', value: '#2774C7' },
  { label: 'Coral', value: '#DB6254' },
  { label: 'Green', value: '#3D8563' },
];

export function includeCurrentColor(colors: typeof PAPER_COLORS, current: string) {
  if (colors.some(item => item.value === current)) return colors;
  const channels = (color: string) => [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  const rgb = channels(current);
  const nearest = colors.map(item => ({ item, distance: channels(item.value).reduce((sum, value, i) => sum + (value - rgb[i]) ** 2, 0) })).sort((a, b) => a.distance - b.distance)[0];
  return nearest && nearest.distance < 1800
    ? colors.map(item => item === nearest.item ? { ...item, value: current } : item)
    : [{ label: 'Custom', value: current }, ...colors];
}

/** A new sticky note gets one of the paper colours at random, never white. */
export function randomNoteColor() {
  const colors = PAPER_COLORS.filter(option => option.value.toUpperCase() !== '#FFFFFF');
  return colors[Math.floor(Math.random() * colors.length)].value;
}
