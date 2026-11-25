import { watchItemPresentation } from '../inventory/presentation.ts';
import { useSurface } from '../observation/context.tsx';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { assetUrl } from '../data/catalog.ts';
import type { EncyclopediaController } from './controller.ts';
import { EncyclopediaView } from './EncyclopediaView.tsx';
import { installPanelBehavior } from './panel.ts';

export function EncyclopediaPanel({ controller, onClose, onOpenItem, embedded=false, initialYokaiId=null }: {
  controller: EncyclopediaController; onClose(): void; onOpenItem?(id: string): void; embedded?:boolean; initialYokaiId?:string|null;
}) {
  const { host, generation } = useSurface();
  const snapshot = useSyncExternalStore(controller.subscribe, () => controller.snapshot);
  const dialog = useRef<HTMLElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  const listPosition = useRef(0);
  const previousEntry = useRef<string | null>(null);
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    let active = true;
    void controller.open().then(() => { if (active && initialYokaiId) void controller.select(initialYokaiId); });
    return () => { active = false; controller.close(); };
  }, [controller, initialYokaiId]);
  useEffect(() => { if(!embedded)return installPanelBehavior({ dialog: dialog.current!, navigation: dialog.current!.ownerDocument.querySelector('.collection-footer-nav'), onClose: () => close.current() }); }, [generation,embedded]);
  useEffect(() => host?.surfaces.subscribe(() => controller.surfaceChanged()), [host, controller]);
  useLayoutEffect(() => {
    const el = scroll.current;
    if (!el || snapshot.phase !== 'ready') return;
    const id = snapshot.selectedId;
    if (id) {
      el.scrollTop = 0;
      el.querySelector<HTMLElement>('[data-detail-heading]')?.focus({ preventScroll: true });
    } else if (previousEntry.current) {
      el.scrollTop = listPosition.current;
      const card = [...el.querySelectorAll<HTMLElement>('[data-entry]')].find(e => e.dataset.entry === previousEntry.current);
      card?.focus({ preventScroll: true });
      card?.scrollIntoView({ block: 'nearest' });
    }
    previousEntry.current = id;
  }, [snapshot.selectedId, snapshot.phase]);
  const selectedNew = snapshot.model?.entries.find(e => e.id === snapshot.selectedId)?.isNew ?? false;
  useEffect(() => {
    const id = snapshot.selectedId, heading = dialog.current?.querySelector<HTMLElement>('[data-detail-heading]');
    if (!id || !heading || !selectedNew || snapshot.phase !== 'ready') return;
    return watchItemPresentation(heading, () => { void controller.presented(id); });
  }, [controller, snapshot.selectedId, snapshot.phase, selectedNew, generation]);
  const view=<EncyclopediaView snapshot={snapshot} dialogRef={dialog} scrollRef={scroll} assetHref={assetUrl} onClose={onClose} onOpenItem={onOpenItem} embedded={embedded}
    onViewedRetry={() => { if (snapshot.selectedId) void controller.presented(snapshot.selectedId); }} onRarity={r => controller.setRarity(r)} onFilter={f => controller.setFilter(f)} onSelect={id => { if (id && !snapshot.selectedId) listPosition.current = scroll.current?.scrollTop ?? 0; void controller.select(id); }}
    onPhoto={s => { void controller.selectPhoto(s); }} onFull={f => { void controller.showFull(f); }}
    onRetry={() => { void controller.retryPhoto(); }} onRefresh={() => { void controller.refresh(); }} onImageError={token => controller.imageFailed(token)} />;
  if(embedded)return view;
  return <div className="encyclopedia-backdrop" data-capture-blocker onPointerDown={event => event.stopPropagation()}
    onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}>
    {view}
  </div>;
}
