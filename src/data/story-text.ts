import overrides from './story-overrides.json' with { type: 'json' };
import itemStories from './item-stories.json' with { type: 'json' };
type StoryEdit = { description?: string; lore?: string; append?: string };
/** Display copy only. Stable IDs, production art, captures and saved records stay intact. */
export function withStoryText<T extends { yokai: readonly { id: string; description: string }[] }>(catalog: T): T {
  return { ...catalog, yokai: catalog.yokai.map(y => {
    const edit = (overrides as Record<string, StoryEdit>)[y.id];
    if (!edit) return y;
    const description = edit.description ?? y.description;
    return { ...y, ...(edit.lore === undefined ? {} : { lore: edit.lore }), description: edit.append ? `${description} ${edit.append}` : description };
  }) };
}

/** Enrich each known item without changing catalog IDs or saved collection data. */
export function withItemStoryText<T extends { items: readonly { id: string; description: string }[] }>(catalog: T): T {
  return { ...catalog, items: catalog.items.map(item => {
    const match = /^item_(\d{3})$/.exec(item.id);
    const story = match ? itemStories[Number(match[1]) - 1] : undefined;
    return story ? { ...item, description: `${item.description} ${story}` } : item;
  }) };
}
