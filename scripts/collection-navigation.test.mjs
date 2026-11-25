import test from 'node:test';
import assert from 'node:assert/strict';
import { toggleCollection } from '../src/app/collection-navigation.ts';

test('collection buttons toggle the selected panel and switch between panels', () => {
  assert.deepEqual(toggleCollection(null, 'inventory'), { kind: 'inventory', itemId: null });
  assert.equal(toggleCollection({ kind: 'inventory', itemId: 'item_001' }, 'inventory'), null);
  assert.deepEqual(toggleCollection({ kind: 'inventory', itemId: null }, 'encyclopedia'), { kind: 'encyclopedia' });
  assert.equal(toggleCollection({ kind: 'encyclopedia', yokaiId: 'yokai_001' }, 'encyclopedia'), null);
});
