import type { Inventory } from '../inventory/model.ts';
export const minigameItemId = 'item_002';
export const minigameRequired = 100;
export function minigameProgress(model: Inventory) {
  const item = model.entries.find(entry => entry.id === minigameItemId);
  const count = item?.status === 'acquired' ? item.totalCount : 0;
  return { count, unlocked: count >= minigameRequired };
}
