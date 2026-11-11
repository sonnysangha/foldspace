// Fills a development account with a set of finished demo spaces: sticky notes,
// spaces inside spaces, photos, checklists, map pins, voice notes, links with previews, connectors and ink. Run it with `npm run seed:demo`.
//
// It signs in as the development test user in .tooling/test-auth.json (or the Clerk
// user id passed as the first argument), using the development Clerk secret key from
// .env.local. A space whose title already exists is left alone, so it is safe to re-run.
// Pass --reset to delete the demo spaces by title and build them again.
// Photos come from picsum.photos, which serves Unsplash-licensed images by id.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../convex/_generated/api.js';

const root = resolve(import.meta.dirname, '..');
const env = { ...process.env };
for (const line of (await readFile(resolve(root, '.env.local'), 'utf8')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_]+)=(.*)$/);
  if (match) env[match[1]] = match[2].replace(/^['"]|['"]$/g, '').replace(/\s+#.*$/, '').trim();
}
if (!env.CLERK_SECRET_KEY?.startsWith('sk_test_')) throw new Error('seed-demo only runs against a Clerk development instance.');

// ---------------------------------------------------------------- content

const Y = '#FFF2B2', G = '#DBEEDC', B = '#E0EDFA', V = '#EFEAFF', P = '#FFE2D8', W = '#FFFFFF';
const INK = '#141414', BLUE = '#2774C7', CORAL = '#DB6254', GREEN = '#3D8563', GOLD = '#E0A526', VIOLET = '#5342D6';

// ---- cards

const note = (title, body, color, x, y, width = 280, height = 240) => ({ kind: 'note', title, body, color, x, y, width, height });
const small = (title, body, color, x, y) => note(title, body, color, x, y, 220, 170);
const photo = (title, picsumId, x, y, width = 300, height = 290) => ({ kind: 'image', title, body: '', color: W, x, y, width, height, picsumId });
/** A link. Its title starts as the site's name; the page's own title and picture replace it once fetched. */
const link = (title, url, body, x, y) => ({ kind: 'link', title, body, color: W, x, y, width: 280, height: 130, url });
/** A checklist. Start an item with '*' to have it already ticked. */
const checklist = (title, items, color, x, y, width = 280, height = 240) => ({
  kind: 'checklist', title, color, x, y, width, height,
  body: items.map(item => item.startsWith('*') ? `[x] ${item.slice(1)}` : `[ ] ${item}`).join('\n'),
});
/** A map pin. `map` is its picture in scripts/seed-assets, made ahead of time with MapKit. */
const place = (title, latitude, longitude, map, x, y) => ({ kind: 'place', title, body: '', color: W, x, y, width: 280, height: 240, latitude, longitude, asset: { file: map, type: 'image/jpeg' } });
/** A voice note. `file` is a short spoken M4A in scripts/seed-assets; `duration` is its length in seconds. */
const voice = (title, file, duration, x, y) => ({ kind: 'audio', title, body: '', color: W, x, y, width: 280, height: 130, duration, asset: { file, type: 'audio/mp4' } });
const space = (title, color, x, y, inside) => ({ kind: 'canvas', title, body: '', color, x, y, width: 280, height: 240, inside });

// ---- ink
// Everything below is drawn the way a hand would: lines wobble, circles overshoot,
// and nothing is perfectly straight. The wobble is seeded, so every run draws the same demo.

let state = 20261110;
const random = () => {
  state = state + 0x6D2B79F5 | 0;
  let t = Math.imul(state ^ state >>> 15, 1 | state);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
  return ((t ^ t >>> 14) >>> 0) / 4294967296;
};
const jitter = (amount) => (random() - 0.5) * 2 * amount;
const shaky = (points, amount = 1.3) => points.map(point => ({ x: point.x + jitter(amount), y: point.y + jitter(amount) }));
const segment = (points) => points.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
/** One stroke, made of one or more separate pen-down runs. */
const ink = (runs, color = INK, width = 3) => ({ path: runs.map(segment).join(' '), color, width });

function bow(from, to, bend, steps = 22) {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  const control = { x: (from.x + to.x) / 2 - (to.y - from.y) / length * bend, y: (from.y + to.y) / 2 + (to.x - from.x) / length * bend };
  const points = [];
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    points.push({ x: (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x, y: (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y });
  }
  return { points, control };
}

/** A curved arrow. `dashed` breaks the line into short runs, like a route on a map. */
function arrow(from, to, { bend = 30, color = INK, width = 3, dashed = false } = {}) {
  const { points, control } = bow(from, to, bend, dashed ? 40 : 22);
  const angle = Math.atan2(to.y - control.y, to.x - control.x);
  const wing = (offset) => ({ x: to.x - Math.cos(angle + offset) * 17, y: to.y - Math.sin(angle + offset) * 17 });
  const line = shaky(points);
  const runs = dashed ? line.reduce((all, point, index) => { if (index % 3 === 0) all.push([]); if (index % 3 !== 2) all[all.length - 1].push(point); return all; }, []).filter(run => run.length > 1) : [line];
  return ink([...runs, [wing(0.5), to, wing(-0.5)]], color, width);
}

/**
 * A real connector between two cards: it is stored with the canvas and follows the
 * cards when they move. Listed alongside the ink, and created after the cards exist.
 */
const connect = (from, to, { color } = {}) => ({ connect: [from, to], color });

/** A circle drawn round something, overshooting where it closes. */
function ring(cx, cy, rx, ry, color = CORAL, width = 3) {
  const points = [], start = -0.4 + jitter(0.4), drift = 1 + jitter(0.04);
  for (let step = 0; step <= 46; step += 1) {
    const t = start + step / 46 * (Math.PI * 2 + 0.55), grow = 1 + (step / 46) * (drift - 1) * 2;
    points.push({ x: cx + Math.cos(t) * rx * grow, y: cy + Math.sin(t) * ry * grow });
  }
  return ink([shaky(points, 1.6)], color, width);
}
const around = (card, color = CORAL, pad = 16) => ring(card.x + card.width / 2, card.y + card.height / 2, card.width / 2 * 1.16 + pad, card.height / 2 * 1.2 + pad, color);

/** Two quick passes under something, for emphasis. */
function underline(x, y, length, color = CORAL, width = 3) {
  const pass = (dy, reverse) => {
    const points = [];
    for (let step = 0; step <= 14; step += 1) points.push({ x: x + length * step / 14, y: y + dy + Math.sin(step / 14 * Math.PI * 2) * 2.5 });
    return shaky(reverse ? points.reverse() : points, 1);
  };
  return ink([[...pass(0, false), ...pass(7, true)]], color, width);
}

function star(cx, cy, r, color = GOLD, width = 3) {
  const points = [];
  for (let i = 0; i <= 5; i += 1) { const t = -Math.PI / 2 + i * Math.PI * 4 / 5; points.push({ x: cx + Math.cos(t) * r, y: cy + Math.sin(t) * r }); }
  return ink([shaky(points, 1)], color, width);
}
function sparkle(cx, cy, r, color = GOLD, width = 2.5) {
  const ray = (t, s) => [{ x: cx - Math.cos(t) * r * s, y: cy - Math.sin(t) * r * s }, { x: cx + Math.cos(t) * r * s, y: cy + Math.sin(t) * r * s }];
  return ink([ray(0, 1), ray(Math.PI / 2, 1), ray(Math.PI / 4, 0.55), ray(-Math.PI / 4, 0.55)], color, width);
}
function sun(cx, cy, r, color = GOLD) {
  const rays = [];
  for (let i = 0; i < 9; i += 1) { const t = i / 9 * Math.PI * 2 + 0.2; rays.push(shaky([{ x: cx + Math.cos(t) * r * 1.45, y: cy + Math.sin(t) * r * 1.45 }, { x: cx + Math.cos(t) * r * 2.05, y: cy + Math.sin(t) * r * 2.05 }], 1.5)); }
  return [ring(cx, cy, r, r, color, 3), ink(rays, color, 3)];
}
function waves(x, y, length, rows = 3, color = BLUE) {
  const runs = [];
  for (let row = 0; row < rows; row += 1) {
    const points = [], shift = row % 2 ? 26 : 0;
    for (let step = 0; step <= 30; step += 1) points.push({ x: x + shift + length * step / 30, y: y + row * 20 + Math.sin(step / 30 * Math.PI * 5) * 7 });
    runs.push(shaky(points, 0.8));
  }
  return ink(runs, color, 2.5);
}
function mountains(x, y, width, height, color = INK) {
  const ridge = [{ x, y }, { x: x + width * 0.2, y: y - height * 0.7 }, { x: x + width * 0.33, y: y - height * 0.3 }, { x: x + width * 0.55, y: y - height }, { x: x + width * 0.74, y: y - height * 0.35 }, { x: x + width * 0.86, y: y - height * 0.6 }, { x: x + width, y }];
  const snow = [{ x: x + width * 0.47, y: y - height * 0.74 }, { x: x + width * 0.53, y: y - height * 0.62 }, { x: x + width * 0.58, y: y - height * 0.76 }, { x: x + width * 0.63, y: y - height * 0.66 }];
  return ink([shaky(ridge, 2), shaky(snow, 1)], color, 3);
}
function heart(cx, cy, s, color = CORAL) {
  const points = [];
  for (let step = 0; step <= 30; step += 1) {
    const t = step / 30 * Math.PI * 2;
    points.push({ x: cx + s * 16 * Math.sin(t) ** 3 / 16, y: cy - s * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16 });
  }
  return ink([shaky(points, 0.8)], color, 3);
}
function spiral(cx, cy, r, color = VIOLET) {
  const points = [];
  for (let step = 0; step <= 60; step += 1) { const t = step / 60 * Math.PI * 5; points.push({ x: cx + Math.cos(t) * r * step / 60, y: cy + Math.sin(t) * r * step / 60 }); }
  return ink([shaky(points, 0.8)], color, 2.5);
}
function tick(x, y, s, color = GREEN) {
  return ink([shaky([{ x, y }, { x: x + s * 0.4, y: y + s * 0.45 }, { x: x + s * 1.25, y: y - s * 0.7 }], 1.2)], color, 4);
}
function zigzag(x, y, length, amp, color = GOLD, width = 3) {
  const points = [];
  for (let step = 0; step <= 16; step += 1) points.push({ x: x + length * step / 16, y: y + (step % 2 ? amp : -amp) });
  return ink([shaky(points, 1.5)], color, width);
}
/** A cup with steam rising off it. */
function cup(x, y, s, color = INK) {
  const steam = (dx) => { const points = []; for (let step = 0; step <= 12; step += 1) points.push({ x: x + dx + Math.sin(step / 12 * Math.PI * 2.5) * s * 0.07, y: y - s * 0.12 - step / 12 * s * 0.5 }); return shaky(points, 0.6); };
  const handle = []; for (let step = 0; step <= 12; step += 1) { const t = -Math.PI / 2 + step / 12 * Math.PI; handle.push({ x: x + s * 0.93 + Math.cos(t) * s * 0.24, y: y + s * 0.4 + Math.sin(t) * s * 0.26 }); }
  return ink([shaky([{ x, y }, { x: x + s * 0.14, y: y + s * 0.82 }, { x: x + s * 0.82, y: y + s * 0.82 }, { x: x + s * 0.96, y }, { x: x - s * 0.02, y }], 1.2), handle, steam(s * 0.3), steam(s * 0.52), steam(s * 0.74)], color, 3);
}
function cloud(cx, cy, s, color = BLUE) {
  const points = [];
  for (let step = 0; step <= 48; step += 1) { const t = step / 48 * Math.PI * 2; const bump = 1 + 0.16 * Math.sin(t * 5); points.push({ x: cx + Math.cos(t) * s * 1.6 * bump, y: cy + Math.sin(t) * s * 0.75 * bump }); }
  return ink([shaky(points, 0.8)], color, 2.5);
}

/**
 * The canvas inside a space. Its cards are nudged off the grid, and it gets a
 * connector between its first two cards plus a small flourish, as well as any `extra` ink.
 */
function inside(cards, extra = []) {
  const placed = cards.map(card => ({ ...card, x: Math.round(card.x + jitter(26)), y: Math.round(card.y + jitter(30)) }));
  const last = placed[placed.length - 1];
  const strokes = [...extra, sparkle(last.x + last.width + 34, last.y - 16, 13)];
  if (placed.length > 1) strokes.push(connect(placed[0], placed[1], { bend: 22 + jitter(14), color: BLUE }));
  if (placed.length > 2) strokes.push(underline(placed[2].x + 14, placed[2].y + placed[2].height + 16, Math.min(150, placed[2].width - 40), CORAL));
  return { cards: placed, strokes };
}

// ---- the five spaces

const roadTrip = (() => {
  const plan = note('Ten days, one loop', 'Fly in, pick up the camper, drive the ring clockwise.\n\nRule for the trip: stop whenever something looks good.', Y, 0, 0, 360, 270);
  const fjord = photo('The fjord lookout', 1015, 450, -84, 330, 310);
  const budget = note('Budget', 'Camper  1,450\nFuel  380\nFood  500\nPools and parks  220\n\nTotal  2,550', W, 872, 28, 250, 250);
  const start = place('Reykjavík', 64.1466, -21.9426, 'reykjavik.jpg', -372, 64);
  const coast = space('Day 1–3 · The coast', B, -84, 396, inside([
    photo('Sea cliffs at golden hour', 1050, 60, 60, 340, 320),
    note('Drive', '190 km, mostly coast road.\nFuel before leaving town.', B, 470, 40),
    small('Don’t miss', 'The black sand beach.\nGo at low tide.', Y, 500, 350),
    photo('Rough water', 1053, 90, 440),
  ], [waves(430, 590, 230, 3, BLUE)]));
  const falls = space('Day 4–6 · Waterfalls', G, 312, 498, inside([
    photo('The big one', 1039, 60, 60, 340, 320),
    note('Hikes', '1. Canyon rim, 2 h, easy\n2. Behind the falls, 40 min, wet\n3. Valley floor, half day', G, 470, 30, 300, 240),
    photo('Valley floor', 1043, 500, 330),
    small('Pack', 'Rain shell, dry bag, spare socks.', P, 110, 450),
    place('Skógafoss', 63.5321, -19.5114, 'skogafoss.jpg', 860, 80),
  ], [mountains(120, 760, 300, 90, GREEN)]));
  const springs = space('Day 7–10 · Hot springs', P, 708, 404, inside([
    photo('The lagoon', 512, 60, 60, 340, 320),
    note('Slow days', 'Soak in the morning.\nRead in the afternoon.\nNo driving after four.', P, 470, 50),
    photo('Camp in the snow', 1036, 440, 350),
    place('Blue Lagoon', 63.8804, -22.4495, 'blue-lagoon.jpg', 830, 110),
  ], [cloud(240, 470, 46, BLUE), heart(330, 560, 20)]));
  const packing = checklist('Packing', ['*Layers', '*Swimwear', 'Headlamp', 'Offline maps'], G, 1094, 356, 240, 200);
  const memo = voice('Before we book', 'trip.m4a', 8.9, 1058, 640);
  const map = link('google.com', 'https://www.google.com/maps', '', 660, 800);
  const cliffs = photo('Green cliffs', 1018, -40, 742, 320, 290);
  return {
    title: 'Northern road trip', color: '#2F6DB5',
    cards: [plan, fjord, budget, start, coast, falls, springs, packing, memo, map, cliffs],
    strokes: [
      connect(start, plan, { bend: -26, color: CORAL }),
      connect(plan, coast, { bend: 30, color: BLUE, dashed: true }),
      connect(coast, falls, { bend: -34, color: BLUE, dashed: true }),
      connect(falls, springs, { bend: 34, color: BLUE, dashed: true }),
      connect(springs, map, { bend: -30, color: BLUE, dashed: true }),
      connect(budget, packing, { bend: 26, width: 2.5 }),
      connect(memo, packing, { bend: -18, color: CORAL, width: 2.5 }),
      around(start, CORAL, 6),
      ...sun(1010, -150, 30),
      mountains(320, 900, 300, 96),
      waves(-380, 372, 220, 3),
      star(410, -120, 17),
      sparkle(830, -70, 14),
      underline(892, 252, 120, CORAL),
      tick(1350, 380, 20),
      heart(1370, 700, 16),
      cloud(700, -150, 38),
    ],
  };
})();

const cafe = (() => {
  const idea = note('The idea', 'A small neighbourhood café.\nGreat filter coffee, four pastries, nothing else.\n\nOpen by spring.', Y, 0, 0, 340, 260);
  const feel = photo('How it should feel', 365, 412, -96, 330, 310);
  const numbers = note('Numbers', 'Rent  2,100 a month\nFit-out  18,000\nBreak-even  140 cups a day', W, 820, -24, 290, 200);
  const menu = space('Menu', P, -96, 352, inside([
    photo('Pour-over bar', 1060, 60, 60, 340, 320),
    photo('Flat white', 431, 450, 30),
    photo('Loose-leaf tea', 225, 800, 80),
    photo('Lemon cookies', 835, 430, 400),
    small('Coffee', 'Filter  3.5\nFlat white  4\nIced  4', Y, 80, 440),
    small('Tea', 'Green, black, mint.\nPot for two  5', G, 800, 430),
    small('Sweet things', 'Lemon cookies, honey cake, one seasonal bake.', P, 100, 660),
  ], [cup(360, 700, 70), star(1080, 30, 16)]));
  const room = space('The room', G, 282, 448, inside([
    note('Layout', 'Bar along the window.\nOne long shared table.\nSix stools, no laptops at lunch.', G, 60, 60, 300, 260),
    photo('Desk for the back office', 20, 440, 30),
    small('Colours', 'Oak, off-white, one deep green wall.', W, 90, 400),
    small('Sound', 'Records only. Quiet before nine.', V, 360, 420),
  ], [spiral(690, 470, 40)]));
  const week = space('Opening week', B, 664, 336, inside([
    small('Monday', 'Soft open for neighbours.', B, 60, 60),
    small('Wednesday', 'First delivery from the roaster.', B, 330, 100),
    small('Friday', 'Free cookie with every coffee.', B, 600, 50),
    checklist('Still to do', ['*Sign the lease', 'Order the grinder', 'Hire one barista', 'Print the menu'], Y, 70, 320, 300, 240),
    link('sweetmarias.com', 'https://www.sweetmarias.com', '', 450, 340),
  ]));
  const honey = photo('Honey for the cake', 312, 1034, 236, 280, 270);
  const board = link('pinterest.com', 'https://www.pinterest.com', '', 990, 580);
  const bake = voice('Seasonal bake idea', 'cafe.m4a', 6.5, -130, 690);
  return {
    title: 'Opening a café', color: '#141414',
    cards: [idea, feel, numbers, menu, room, week, honey, board, bake],
    strokes: [
      connect(idea, menu, { bend: 24 }),
      connect(menu, room, { bend: -30 }),
      connect(room, week, { bend: 30 }),
      connect(numbers, week, { bend: -24, color: CORAL, width: 2.5 }),
      connect(bake, menu, { bend: -20, color: CORAL, width: 2.5 }),
      connect(honey, week, { bend: 22, color: GOLD, width: 2.5 }),
      around(numbers, CORAL, 4),
      cup(230, 760, 96),
      star(380, -130, 18),
      sparkle(770, -90, 14),
      zigzag(20, 284, 200, 5, GOLD),
      heart(1350, 250, 17),
      underline(1010, 730, 170, BLUE),
      spiral(-190, 250, 34),
    ],
  };
})();

const recipes = (() => {
  const rules = note('House rules', 'Thirty minutes or less.\nOne pan where possible.\nEverything here has been cooked twice.', G, 0, 0, 320, 230);
  const haul = photo('Market haul', 1080, 392, -116, 320, 300);
  const sweet = photo('Something sweet', 674, 770, -44, 300, 290);
  const salad = space('Rainbow salad', G, -84, 322, inside([
    photo('The bowl', 488, 60, 60, 340, 320),
    note('You need', 'Red cabbage\nPeppers\nSpring onion\nSesame oil\nLime', G, 480, 30, 240, 260),
    note('Do this', '1. Slice everything thin.\n2. Whisk oil, lime and salt.\n3. Toss and eat straight away.', W, 440, 370, 320, 220),
  ], [star(250, 470, 18, GREEN)]));
  const bowl = space('Berry breakfast bowl', P, 276, 404, inside([
    photo('Yoghurt and strawberries', 493, 60, 60, 340, 320),
    photo('Raspberries', 429, 480, 20),
    note('Do this', 'Thick yoghurt, a handful of oats, whatever berries are in the fridge, honey on top.', P, 450, 390, 300, 200),
  ], [heart(260, 470, 22)]));
  const tray = space('Roast vegetable tray', Y, 636, 316, inside([
    photo('Prep', 292, 60, 60, 340, 320),
    note('You need', 'Red onion\nParsnip\nCarrot\nPeppercorns\nOlive oil', Y, 470, 40, 240, 260),
    small('Oven', '220°C, 25 minutes. Turn once.', W, 480, 380),
  ], [zigzag(100, 450, 220, 8, CORAL)]));
  const list = checklist('Shopping list', ['Limes', 'Yoghurt', 'Oats', '*Red cabbage', 'Honey'], Y, 1026, 300, 240, 220);
  const tip = voice('Salad tip', 'recipe.m4a', 5.2, -60, 650);
  const more = link('bbcgoodfood.com', 'https://www.bbcgoodfood.com', '', 640, 660);
  return {
    title: 'Weeknight recipes', color: '#2F7D5B',
    cards: [rules, haul, sweet, salad, bowl, tray, list, tip, more],
    strokes: [
      connect(rules, salad, { bend: 22, color: GREEN }),
      connect(salad, bowl, { bend: -28, color: GREEN }),
      connect(bowl, tray, { bend: 28, color: GREEN }),
      connect(haul, list, { bend: -70, color: CORAL, width: 2.5, dashed: true }),
      connect(tip, salad, { bend: -16, color: CORAL, width: 2.5 }),
      connect(tray, more, { bend: 18, width: 2.5 }),
      around(bowl, CORAL, 2),
      star(350, -150, 18),
      sparkle(1110, -60, 15),
      heart(1100, 120, 18),
      tick(1290, 320, 20),
      underline(20, 250, 180, GREEN),
      spiral(330, 760, 36, GOLD),
      zigzag(960, 700, 180, 6, GOLD),
    ],
  };
})();

const moodboard = (() => {
  const colour = photo('Colour', 1069, 0, 0, 340, 320);
  const chrome = photo('Chrome and curves', 1071, 388, -72, 300, 290);
  const still = photo('Stillness', 1074, 734, 16, 340, 320);
  const dusk = photo('City at dusk', 1067, -70, 372, 300, 290);
  const brick = photo('Brick and shadow', 1047, 276, 262, 340, 320);
  const stone = photo('Water and old stone', 164, 664, 388, 320, 300);
  const palette = small('Palette', 'Deep blue, one orange accent, lots of warm grey.', B, 1130, -60);
  const type = small('Type', 'One serif for headlines. One grotesk for everything else.', V, 1104, 178);
  const feeling = small('Feeling', 'Calm, a little cinematic, nothing shiny.', P, 1040, 470);
  const refs = space('References to keep', V, 300, 660, inside([
    photo('Long streets', 57, 60, 60, 340, 320),
    note('Why these', 'Strong verticals, one vanishing point, soft light.', V, 480, 90),
  ]));
  return {
    title: 'Studio moodboard', color: '#8A63B8',
    cards: [colour, chrome, still, dusk, brick, stone, palette, type, feeling, refs],
    strokes: [
      connect(palette, still, { bend: -22, color: BLUE }),
      connect(type, still, { bend: 18, color: VIOLET, width: 2.5 }),
      connect(feeling, stone, { bend: 20, color: CORAL }),
      connect(brick, refs, { bend: -20, width: 2.5 }),
      connect(colour, chrome, { bend: -40, color: GOLD, width: 2.5 }),
      around(palette, BLUE, 2),
      star(350, -150, 20),
      sparkle(1090, -110, 15),
      sparkle(-110, 330, 12, VIOLET),
      spiral(660, 800, 44),
      heart(-100, 720, 18),
      zigzag(1050, 690, 200, 6, GOLD),
      underline(40, 344, 160, CORAL),
      cloud(720, -110, 36, VIOLET),
    ],
  };
})();

const buildLog = (() => {
  const week = note('This week', 'Ship the canvas zoom.\nMake notes feel like notes.\nSeed a demo worth showing.', Y, 0, 0, 330, 250);
  const desk = photo('Where the work happens', 180, 398, -90, 330, 310);
  const breakTime = photo('Break time', 96, 800, -120, 290, 280);
  const expo = link('docs.expo.dev', 'https://docs.expo.dev', '', -400, 250);
  const convex = link('docs.convex.dev', 'https://docs.convex.dev', '', -70, 330);
  const clerk = link('clerk.com', 'https://clerk.com/docs', '', -380, 560);
  const parked = space('Ideas parked for later', V, 326, 344, inside([
    small('Dark mode', 'Paper turns to slate. Notes keep their colour.', V, 60, 60),
    small('Shared spaces', 'Invite one person to one space.', B, 330, 100),
    small('Pinch to enter', 'Zoom into a space with two fingers.', G, 90, 290),
    small('Link previews', 'Show the page title and a thumbnail.', P, 350, 320),
  ], [spiral(650, 250, 40)]));
  const shipped = checklist('Shipped', ['*Edge-to-edge canvas', '*Sticky notes in colour', '*Spaces inside spaces', '*Undo for everything', 'Connectors between cards'], G, 700, 268, 300, 240);
  return {
    title: 'Build log', color: '#C8321E',
    cards: [week, desk, breakTime, expo, convex, clerk, parked, shipped],
    strokes: [
      connect(week, parked, { bend: 24, color: CORAL }),
      connect(parked, shipped, { bend: -26, color: GREEN }),
      connect(expo, parked, { bend: -14, width: 2.5 }),
      connect(convex, parked, { bend: 10, width: 2.5 }),
      connect(clerk, parked, { bend: 26, width: 2.5 }),
      connect(desk, breakTime, { bend: -36, color: GOLD, width: 2.5, dashed: true }),
      around(week, CORAL, 0),
      tick(1020, 280, 24),
      star(360, -150, 18),
      sparkle(1130, -60, 15),
      zigzag(720, 540, 220, 6, GOLD),
      heart(1110, 200, 16),
      cup(420, 640, 84),
      underline(-360, 850, 200, BLUE),
    ],
  };
})();

const spaces = [roadTrip, cafe, recipes, moodboard, buildLog];

// ---------------------------------------------------------------- sign in

async function clerk(path, body) {
  const response = await fetch(`https://api.clerk.com/v1${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${env.CLERK_SECRET_KEY}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`Clerk ${path.split('/')[1]} request failed (${response.status}).`);
  return response.json();
}

const flags = process.argv.slice(2);
const reset = flags.includes('--reset');
let userId = flags.find(flag => !flag.startsWith('--'));
if (!userId) userId = JSON.parse(await readFile(resolve(root, '.tooling/test-auth.json'), 'utf8')).primary.id;
const instance = await clerk('/instance');
if (instance.environment_type !== 'development') throw new Error('seed-demo only runs against a Clerk development instance.');
const session = await clerk('/sessions', { user_id: userId });
const mint = async () => (await clerk(`/sessions/${session.id}/tokens/convex`, { expires_in_seconds: 600 })).jwt;

const client = new ConvexHttpClient(env.EXPO_PUBLIC_CONVEX_URL, { logger: false });
let token = await mint();
let mintedAt = Date.now();
/** Tokens are short-lived, so a fresh one is taken every few minutes. */
async function authed() {
  if (Date.now() - mintedAt > 4 * 60_000) { token = await mint(); mintedAt = Date.now(); }
  client.setAuth(token);
  return token;
}

// ---------------------------------------------------------------- write

const photoCache = new Map();
async function photoBytes(id) {
  if (!photoCache.has(id)) {
    const response = await fetch(`https://picsum.photos/id/${id}/1200/900.jpg`);
    if (!response.ok) throw new Error(`Could not download photo ${id} (${response.status}).`);
    photoCache.set(id, new Uint8Array(await response.arrayBuffer()));
  }
  return photoCache.get(id);
}

async function upload(workspaceId, bytes, type = 'image/jpeg') {
  const response = await fetch(`${env.EXPO_PUBLIC_CONVEX_SITE_URL}/upload?workspaceId=${workspaceId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${await authed()}`, 'Content-Type': type }, body: bytes,
  });
  if (!response.ok) throw new Error(`Upload failed (${response.status}).`);
  return (await response.json()).storageId;
}

let cardCount = 0, strokeCount = 0, photoCount = 0;
let connectorCount = 0;
async function fill(workspaceId, canvasId, content) {
  const ids = new Map();
  for (const source of content.cards) {
    const { inside, picsumId, asset, ...card } = source;
    // A photo comes from picsum; a map picture or voice note comes from scripts/seed-assets.
    const imageStorageId = picsumId !== undefined ? await upload(workspaceId, await photoBytes(picsumId))
      : asset ? await upload(workspaceId, new Uint8Array(await readFile(resolve(root, 'scripts/seed-assets', asset.file))), asset.type) : undefined;
    if (picsumId !== undefined) photoCount += 1;
    await authed();
    const created = await client.mutation(api.cards.create, { ...card, canvasId, ...(imageStorageId ? { imageStorageId } : {}) });
    cardCount += 1;
    ids.set(source, created._id);
    // Link cards fetch their own preview: the page's title, description and picture.
    if (card.kind === 'link') { await authed(); await client.action(api.links.refresh, { id: created._id }).catch(() => {}); }
    if (inside) await fill(workspaceId, created.childCanvasId, inside);
  }
  for (const stroke of content.strokes) {
    await authed();
    if (stroke.connect) {
      const [from, to] = stroke.connect;
      await client.mutation(api.connectors.toggle, { canvasId, fromCardId: ids.get(from), toCardId: ids.get(to), ...(stroke.color ? { color: stroke.color } : {}) });
      connectorCount += 1;
    } else {
      await client.mutation(api.strokes.create, { canvasId, ...stroke });
      strokeCount += 1;
    }
  }
}

try {
  await authed();
  const current = await client.query(api.workspaces.list, {});
  if (reset) {
    // --reset replaces the demo spaces: any space with one of these titles is deleted first.
    const titles = new Set(spaces.map(item => item.title));
    for (const item of current.filter(item => titles.has(item.title))) {
      await authed();
      await client.mutation(api.workspaces.remove, { id: item._id });
      console.log(`Removed  ${item.title}`);
    }
  }
  const existing = new Set(reset ? [] : current.map(item => item.title));
  // Created last-to-first so the first space in the list above ends up newest, at the top.
  for (const item of [...spaces].reverse()) {
    if (existing.has(item.title)) { console.log(`Kept     ${item.title} (already there)`); continue; }
    await authed();
    const created = await client.mutation(api.workspaces.create, { title: item.title, color: item.color });
    await fill(created._id, created.rootCanvasId, item);
    console.log(`Created  ${item.title}`);
  }
  console.log(`\n${cardCount} cards, ${photoCount} photos, ${connectorCount} connectors, ${strokeCount} strokes.`);
} finally {
  await clerk(`/sessions/${session.id}/revoke`, {}).catch(() => {});
}
