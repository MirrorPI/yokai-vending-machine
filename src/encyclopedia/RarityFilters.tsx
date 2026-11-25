import { rarityNames } from './model.ts';
import type { RarityFilter } from './model.ts';
export function RarityFilters({ value = 'all', onChange }: { value?: RarityFilter; onChange?(value: RarityFilter): void }) {
  return <nav className="encyclopedia-filters rarity-filters" aria-label="등급 필터">
    {(['all', 'common', 'rare', 'legendary', 'special'] as const).map(r => <button key={r} data-rarity={r}
      aria-pressed={value === r} onClick={() => onChange?.(r)}>{r === 'all' ? '모든 등급' : rarityNames[r]}</button>)}
  </nav>;
}
