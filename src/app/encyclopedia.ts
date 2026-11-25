import sharedPhotos from '../data/generated/shared-photos.json';
import { sharedPhotoKey } from '../photos/shared.ts';
import type { GamePorts } from '../account/remote.ts';
import { assetCatalog } from '../data/catalog.ts';
import { EncyclopediaController } from '../encyclopedia/controller.ts';
import { createBrowserRepository } from '../storage/browser.ts';
import { createPhotoStore } from '../storage/photos.ts';
import { subscribeGameChanges } from '../storage/changes.ts';

/** Reading is independent of A10 ownership. Construction starts no I/O. */
export function createOrdinaryEncyclopedia(subscribeChanges = subscribeGameChanges, ports?: Pick<GamePorts, 'repository' | 'files'>) {
  const repository = ports?.repository ?? createBrowserRepository();
  return new EncyclopediaController({ catalog: assetCatalog, repository,
    sharedPhotoHref: (id, season, family, full) => {
      const photo = (sharedPhotos as Record<string, { portrait: string; full: string }>)[sharedPhotoKey(id, season, family)];
      return photo ? `${import.meta.env.BASE_URL}${photo[full ? 'full' : 'portrait']}` : undefined;
    },
    markViewed: async id => {
      try {
        const command = { type: 'markYokaiViewed' as const, yokaiId: id, viewedAt: new Date().toISOString() };
        for (let attempt = 0; attempt < 3; attempt++) {
          const result = await repository.commit(command);
          if (result.status !== 'conflict') return result.status === 'applied' || result.status === 'unchanged';
        }
        return false;
      } catch { return false; }
    },
    files: ports?.files ?? createPhotoStore({ repository }), subscribeChanges });
}
