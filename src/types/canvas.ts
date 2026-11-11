export type CanvasMode = 'select' | 'draw' | 'erase';

/** note: title and description. canvas: a space you step into. image and link: media on the canvas. */
export type CardKind = 'note' | 'canvas' | 'image' | 'link' | 'checklist' | 'audio' | 'place';

export type Viewport = { x: number; y: number; scale: number };

export type CanvasPreview = {
  cardCount: number;
  strokeCount: number;
  cards: { _id: string; kind: CardKind; title: string; body: string; color: string; x: number; y: number; width: number; height: number; imageUrl?: string }[];
  strokes: { path: string; color: string; width: number }[];
};

export type CanvasCard = {
  _id: string;
  canvasId: string;
  childCanvasId: string;
  kind: CardKind;
  title: string;
  body: string;
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
  imageUrl?: string | null;
  url?: string;
  /** A link's share picture, found on its page. */
  linkImage?: string;
  /** Length of a voice note, in seconds. */
  duration?: number;
  latitude?: number;
  longitude?: number;
  preview?: CanvasPreview;
};

export type CanvasStroke = {
  _id: string;
  canvasId: string;
  path: string;
  color: string;
  width: number;
};

/** A line that joins two cards and follows them when either one moves. */
export type CanvasConnector = { _id: string; fromCardId: string; toCardId: string; color?: string };

export type NewStroke = Pick<CanvasStroke, 'path' | 'color' | 'width'>;
export type CameraAction = { id: number; kind: 'fit' | 'focus'; cardId?: string };

export type CanvasSurfaceProps = {
  cards: CanvasCard[];
  strokes: CanvasStroke[];
  connectors?: CanvasConnector[];
  /** While choosing a card to connect to, a tap on a space selects it instead of stepping in. */
  connecting?: boolean;
  selectedConnectorId?: string | null;
  /** A connector was tapped, or null when the tap landed elsewhere. */
  onSelectConnector?: (connector: CanvasConnector | null) => void;
  mode: CanvasMode;
  selectedId: string | null;
  color: string;
  strokeWidth: number;
  initialViewport?: Viewport;
  preferReadableStart?: boolean;
  cameraAction?: CameraAction;
  captureRequest?: number;
  onCapture?: (image: string | null, requestId: number) => void;
  onInteraction?: () => void;
  onSelect: (card: CanvasCard | null) => void;
  onDragSelect?: (card: CanvasCard) => void;
  onOpen: (card: CanvasCard) => void;
  onMove: (id: string, x: number, y: number) => void;
  onStroke: (stroke: NewStroke) => void;
  onErase: (ids: string[]) => void;
  onViewportChange?: (viewport: Viewport) => void;
  onCanvasPoint?: (x: number, y: number) => void;
  /** Set on a canvas that has a parent: a deep pinch out steps back to it. */
  onPinchOut?: () => void;
  /** Called just before a card is stepped into, to save drafts and drop the keyboard. */
  onWillOpen?: (card: CanvasCard) => void;
  /** Cards selected together; they are outlined and move as one. */
  groupIds?: string[];
  /** The note whose title and text are being typed directly on the card. */
  editing?: { id: string; title: string; body: string; selectAll?: boolean; onTitleChange: (value: string) => void; onBodyChange: (value: string) => void };
  /** The voice note that is playing, shown with a pause button. */
  playingId?: string | null;
  /** A connector was dragged from one card's dot onto another card. */
  onConnect?: (fromCardId: string, toCardId: string) => void;
  /** A card's corner was dragged to a new size. */
  onResize?: (id: string, width: number, height: number) => void;
  /** A card was held and let go without moving; `at` is where on the surface. */
  onCardMenu?: (card: CanvasCard, at: { x: number; y: number }) => void;
  /** Empty canvas was double-tapped at this canvas position. */
  onAddAt?: (point: { x: number; y: number }) => void;
  /** A selection box was drawn round these cards. */
  onGroupSelect?: (ids: string[]) => void;
  /** A voice note's play button was tapped. */
  onPlay?: (card: CanvasCard) => void;
  /** Whether the view shows only empty canvas although there are cards elsewhere. */
  onLostContent?: (lost: boolean) => void;
  /** A tick box on a checklist card was tapped. */
  onToggleItem?: (card: CanvasCard, index: number) => void;
};
