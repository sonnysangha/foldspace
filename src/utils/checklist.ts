export type ChecklistItem = { done: boolean; text: string };

/** A checklist is stored in a card's body, one item per line: "[ ] to do" or "[x] done". */
export function parseChecklist(body: string): ChecklistItem[] {
  return body.split('\n').filter(line => line.trim()).map(line => {
    const match = line.match(/^\s*\[( |x|X)\]\s?(.*)$/);
    return match ? { done: match[1] !== ' ', text: match[2] } : { done: false, text: line.trim() };
  });
}

export function serializeChecklist(items: readonly ChecklistItem[]) {
  return items.map(item => `[${item.done ? 'x' : ' '}] ${item.text.replace(/\n/g, ' ')}`).join('\n');
}

export function toggleChecklistItem(body: string, index: number) {
  return serializeChecklist(parseChecklist(body).map((item, i) => i === index ? { ...item, done: !item.done } : item));
}
