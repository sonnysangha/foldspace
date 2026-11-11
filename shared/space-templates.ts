export type SpaceTemplateId = 'blank' | 'storyboard' | 'project' | 'journal';
export type TemplateCard = {
  title: string; body: string; color: string; kind: 'note' | 'canvas';
  x: number; y: number; width: number; height: number; children?: TemplateCard[];
};
const note = (title: string, body: string, color: string, x: number, y: number, width = 270, height = 220): TemplateCard => ({ title, body, color, x, y, width, height, kind: 'note' });
export const spaceTemplates: { id: SpaceTemplateId; title: string; description: string; cards: TemplateCard[] }[] = [
  { id: 'blank', title: 'Blank', description: 'An empty canvas.', cards: [] },
  { id: 'storyboard', title: 'Story', description: 'Three acts, each with a canvas inside for scenes.', cards: [
    { ...note('01 · The beginning', 'Where are we? Who do we follow? What makes us curious?', '#FFFFFF', 60, 70), kind: 'canvas', children: [note('The opening image', 'Describe the first thing we see. What feeling should it leave?', '#FFFFFF', 60, 80), note('The first words', 'A sound, a question, or a line of voiceover.', '#FFFFFF', 390, 100)] },
    { ...note('02 · Something changes', 'A discovery, a surprise, a different way of seeing.', '#FFFFFF', 400, 70), kind: 'canvas', children: [note('The turning point', 'What changes for our character?', '#FFFFFF', 80, 80)] },
    { ...note('03 · What stays', 'End with an image or a feeling worth carrying home.', '#FFFFFF', 740, 70), kind: 'canvas', children: [note('The final image', 'Echo the beginning. Let something small feel different.', '#FFFFFF', 80, 80)] },
    note('The heart of the story', 'In one sentence, what is this really about?', '#FFFFFF', 280, 400, 380, 175),
  ] },
  { id: 'project', title: 'Project', description: 'A goal, a place for references and next steps.', cards: [
    note('The north star', 'What are we making, and why should it exist?', '#FFFFFF', 70, 80, 310, 220),
    { ...note('Inspiration', 'Collect references, questions, and things that spark an idea.', '#FFFFFF', 460, 70, 320, 250), kind: 'canvas', children: [note('A spark', 'Something worth exploring…', '#FFFFFF', 100, 100)] },
    note('The next small step', '□ Start with one thing\n□ Make a rough version\n□ Share it with someone', '#FFFFFF', 160, 390, 340, 230),
  ] },
  { id: 'journal', title: 'Journal', description: 'Three prompts for a daily note.', cards: [
    note('On my mind', 'Follow a thought. There is no right place to begin.', '#FFFFFF', 80, 70, 340, 270),
    note('Something good', 'A small moment worth remembering.', '#FFFFFF', 510, 110, 280, 210),
    note('A little room for tomorrow', 'One thing to try. One thing to let go.', '#FFFFFF', 230, 420, 340, 200),
  ] },
];
