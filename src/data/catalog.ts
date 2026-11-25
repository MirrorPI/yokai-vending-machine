import { withItemStoryText, withStoryText } from './story-text.ts';
import { withSpecialMotion } from '../scene/special-motion.ts';
import generated from './generated/asset-catalog.json';

/** Static definitions only. User collection/save data must never be added here. */
export const assetCatalog = withItemStoryText(withStoryText(withSpecialMotion(generated)));

export interface AssetFile {
  sourcePath: string;
  publicPath: string;
  sha256: string;
  bytes: number;
  size: number[] | null;
}

/** publicPath is relative to public/, so Vite's base works for nested hosting too. */
export function assetUrl(file: AssetFile): string {
  return `${import.meta.env.BASE_URL}game-content/${file.sha256}.${file.publicPath.split('.').at(-1)}`;
}
