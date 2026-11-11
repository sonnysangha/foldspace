/** The parts of a card that can be shown changed before the server has answered: its paper and its size. */
export type CardLook = { color?: string; width?: number; height?: number };

/**
 * A canvas as it will read once a card's colour or size change has been saved. Returns the
 * same canvas untouched when there is nothing to show yet: the change is only a move, the
 * card is not on this canvas, or it already looks that way. Never alters what it is given.
 */
export function withCardLook<Card extends { _id: string; color: string; width: number; height: number }, Canvas extends { cards: Card[] }>(
  canvas: Canvas, id: string, look: CardLook,
): Canvas {
  const card = canvas.cards.find(item => item._id === id);
  if (!card) return canvas;
  // The server stores colours in capitals; matching it here means its answer changes nothing on screen.
  const color = look.color === undefined ? card.color : look.color.toUpperCase();
  const width = look.width ?? card.width, height = look.height ?? card.height;
  if (color === card.color && width === card.width && height === card.height) return canvas;
  return { ...canvas, cards: canvas.cards.map(item => item === card ? { ...card, color, width, height } : item) };
}
