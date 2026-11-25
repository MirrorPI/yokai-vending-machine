import { useState } from 'react';
import type { RefObject } from 'react';
import type { AssetFile } from '../data/catalog.ts';
import { formatCaptureTime } from '../encyclopedia/capture-time.ts';
import { RarityFilters } from '../encyclopedia/RarityFilters.tsx';
import { rarityNames } from '../encyclopedia/model.ts';
import type { RarityFilter } from '../encyclopedia/model.ts';
import type { InventorySnapshot } from './controller.ts';
import { filterInventory } from './model.ts';
import type { AcquiredItem, Inventory, InventoryFilter } from './model.ts';

const filters: [InventoryFilter, string][] = [['all', '전체'], ['common', '사계절'], ['spring', '봄'], ['summer', '여름'], ['autumn', '가을'], ['winter', '겨울']];
const labels = Object.fromEntries(filters);
type IconHref = (file: AssetFile) => string;

function Icon({ item, assetHref, size = 64, decorative = false }: { item: AcquiredItem; assetHref: IconHref; size?: number; decorative?: boolean }) {
  const [failed, setFailed] = useState(false);
  return failed ? <span className="inventory-icon-failed" aria-hidden={decorative || undefined} role="img" aria-label="물건 그림 없음">◇</span>
    : <img className="inventory-icon" src={assetHref(item.icon)} width={size} height={size} alt={decorative ? '' : item.name} onError={() => setFailed(true)}/>;
}
interface InventoryViewProps {
  embedded?: boolean;
  snapshot: InventorySnapshot; dialogRef?: RefObject<HTMLElement | null>; scopeRef?: RefObject<HTMLDivElement | null>;
  scrollRef?: RefObject<HTMLDivElement | null>;
  assetHref?: IconHref; timeOptions?: { locale?: string; timeZone?: string };
  onRarity?(rarity: RarityFilter): void;
  onOpenOwner?(itemId: string): void;
  onClose(): void; onSelect(id: string | null): void; onFilter(filter: InventoryFilter): void; onRefresh(): void; onRetry(): void;
}
function ItemDate({ value, timeZone }: { value: string | null; timeZone?: string }) {
  return value ? <time dateTime={value}>{formatCaptureTime(value, timeZone).replace(/:\d{2}$/, '')}</time> : <>기록 없음</>;
}
function ItemPager({ entry, props }: { entry: AcquiredItem; props: InventoryViewProps }) {
  const { snapshot: s } = props;
  const acquired = new Map(s.model?.entries.filter((e): e is AcquiredItem => e.status === 'acquired').map(e => [e.id, e]));
  const order = (s.detailOrder ?? (s.model ? filterInventory(s.model, s.filter, s.rarity).map(e => e.id) : []))
    .filter(id => acquired.has(id));
  const index = order.indexOf(entry.id), previous = index > 0 ? acquired.get(order[index - 1]) : undefined;
  const next = index >= 0 ? acquired.get(order[index + 1]) : undefined;
  return <nav className="inventory-detail-pager collection-detail-pager" aria-label="물건 넘기기">
      <button data-stone="back" disabled={!previous} aria-label={previous ? `이전 물건: ${previous.name}` : '이전 물건'}
        onClick={() => { if (previous) props.onSelect(previous.id); }}><span aria-hidden="true">‹ </span>이전</button>
      <span className="inventory-detail-position" aria-label="현재 물건 위치">{index >= 0 ? `${index + 1} / ${order.length}` : '1 / 1'}</span>
      <button data-stone="primary" disabled={!next} aria-label={next ? `다음 물건: ${next.name}` : '다음 물건'}
        onClick={() => { if (next) props.onSelect(next.id); }}>다음<span aria-hidden="true"> ›</span></button>
    </nav>;
}
function ItemDetail({ entry, props, assetHref }: {
  entry: AcquiredItem; props: InventoryViewProps; assetHref: IconHref;
}) {
  const { snapshot: s, scopeRef, timeOptions } = props;
  return <article className="inventory-detail" data-rarity={entry.rarity}>
    <div className="guide-detail-nav"><button data-stone="back" onClick={() => props.onSelect(null)}>
      <span aria-hidden="true">‹ </span>가방으로</button></div>
      <header className="inventory-hero guide-entry-heading">
        <div className="inventory-art"><Icon key={entry.id} item={entry} assetHref={assetHref} decorative/></div>
        <div><h3 tabIndex={-1} data-detail-heading>{entry.name}</h3>
          <div className="guide-entry-meta"><span className="rarity-badge">{rarityNames[entry.rarity]}</span>
            <span>{labels[entry.category]}</span>{entry.isNew && <span className="collection-new">NEW</span>}</div>
        </div>
      </header>
      <section className="guide-section">
        <div className="guide-section-title"><h4>모은 수량</h4></div>
        <div ref={scopeRef} data-item-scope className="inventory-scope inventory-totals">
          <div><strong>{entry.totalCount}<small>개</small></strong><span>누적 수량</span></div>
          <div><strong>{entry.manualCount}<small>개</small></strong><span>직접 만남</span></div>
          <div><strong>{entry.leftCount}<small>개</small></strong><span>두고 간 물건</span></div>
        </div>
        {entry.unreadCount > 0 && <p className="inventory-unread-line">미확인 {entry.unreadCount}개
          {entry.unreadLeftCount > 0 && <> · 그중 두고 간 물건 {entry.unreadLeftCount}개</>}</p>}
        {s.ack.state === 'error' && <p className="guide-note" role="status">확인을 저장하지 못했어요. <button onClick={props.onRetry}>확인 다시 저장</button></p>}
      </section>
      <section className="guide-section">
        <div className="guide-section-title"><h4>물건 이야기</h4></div>
        <p>{entry.description}</p>
        <div className="inventory-owner"><span>남긴 요괴 · {entry.ownerName}</span>
        {props.onOpenOwner && <button data-stone="primary" onClick={() => props.onOpenOwner?.(entry.id)}>요괴 도감 보기</button>}</div>
      </section>
      <section className="guide-section">
        <div className="guide-section-title"><h4>획득 기록</h4></div>
        <dl className="guide-photo-meta">
          <div><dt>처음 획득</dt><dd><ItemDate value={entry.firstObtainedAt} timeZone={timeOptions?.timeZone}/></dd></div>
          <div><dt>최근 획득</dt><dd><ItemDate value={entry.lastObtainedAt} timeZone={timeOptions?.timeZone}/></dd></div>
        </dl>
      </section>
  </article>;
}

function InventoryIndex({ model, props, assetHref }: { model: Inventory; props: InventoryViewProps; assetHref: IconHref }) {
  const { snapshot: s, onSelect, onFilter, onRarity } = props;
  const entries = filterInventory(model, s.filter, s.rarity).filter((entry): entry is AcquiredItem => entry.status === 'acquired');
  const { progress: p } = model;
  return <>
    <div className="inventory-summary" aria-label="가방 현황">
      <div className="inventory-summary-counts"><span>가방 속 물건 <strong>{p.kinds}종</strong></span>
        <span>보유 수량 <strong>{p.quantity}개</strong></span></div>
    </div>
    <details className="guide-filters inventory-filter-drawer"><summary>물건 골라 보기 <span>계절 · 등급</span></summary>
      <p className="guide-filter-label">등장 계절</p>
      <nav className="encyclopedia-filters" aria-label="물건 분류">{filters.map(([f, label]) => <button key={f} aria-pressed={s.filter === f} onClick={() => onFilter(f)}>{label}</button>)}</nav>
      <p className="guide-filter-label">등급</p><RarityFilters value={s.rarity} onChange={onRarity}/>
    </details>
    <div className="guide-results">
      <p className="encyclopedia-filter-count" role="status">{labels[s.filter]} · {entries.length}종 · {s.rarity && s.rarity !== 'all' ? rarityNames[s.rarity] : '모든 등급'}</p>
      {p.unread > 0 && <span>미확인 먼저</span>}
    </div>
    <section className="inventory-bag" aria-label="보유 물건">
      <div className="inventory-bag-seam" aria-hidden="true"/>
      {entries.length === 0 ? <div className="inventory-bag-empty" role="status">
        <strong>{p.kinds === 0 ? '가방이 아직 비어 있어요' : '조건에 맞는 물건이 없어요'}</strong>
        <p>{p.kinds === 0 ? '요괴에게 받은 물건을 여기에 담아 둘게요.' : '계절이나 등급을 바꿔 보세요.'}</p>
      </div> : <div className="inventory-grid">{entries.map(e => <button className="inventory-slot"
        data-rarity={e.rarity} data-new={e.isNew || undefined} data-increased={!e.isNew && e.unreadCount > 0 || undefined} data-item-entry={e.id} key={e.id}
        aria-label={`${e.name}, ${e.totalCount}개, ${rarityNames[e.rarity]}${e.isNew ? ', 새 물건' : e.unreadCount > 0 ? `, 새로 ${e.unreadCount}개 추가` : ''}`}
        title={`${e.name} · ${rarityNames[e.rarity]}`} onClick={() => onSelect(e.id)}>
        <span className="inventory-slot-status">{e.isNew ? <span className="inventory-slot-new">NEW</span> : e.unreadCount > 0 &&
          <span className="inventory-slot-added" title={`마지막 확인 이후 ${e.unreadCount}개 추가`}>+{e.unreadCount}</span>}</span>
        <Icon item={e} assetHref={assetHref} size={48} decorative/>
        <span className="inventory-slot-count">×{e.totalCount}</span>
      </button>)}</div>}
      <p className="inventory-bag-hint">물건을 누르면 설명을 볼 수 있어요</p>
    </section>
    {model.preserved > 0 && <p className="guide-note">이전 물건 기록은 보관 중이에요.</p>}
  </>;
}

export function InventoryView(props: InventoryViewProps) {
  const { snapshot: s, dialogRef, scrollRef, embedded = false, assetHref = f => f.publicPath } = props;
  const entry = s.model?.entries.find((e): e is AcquiredItem => e.id === s.selectedId && e.status === 'acquired');
  return <section className="encyclopedia-panel field-guide inventory-panel" role={embedded ? 'region' : 'dialog'}
    aria-labelledby="inventory-title" tabIndex={-1} ref={dialogRef}>
    <header className="encyclopedia-header guide-header"><div><span>요괴가 건넨 작은 선물</span><h2 id="inventory-title">물건함</h2></div>
      {<button onClick={props.onClose} aria-label="물건함 닫기">닫기</button>}</header>
    <div className="encyclopedia-scroll guide-scroll inventory-scroll" ref={scrollRef}>
      {s.phase === 'loading' && <p className="guide-note" role="status">물건함을 여는 중…</p>}
      {s.phase === 'error' && <div className="guide-note" role="alert">
        <p>{s.error === 'corrupt' ? '저장 내용을 읽을 수 없어요. 원본 기록은 보관돼 있어요.'
          : s.error === 'unsupported-version' ? '이 게임 버전에서는 저장된 물건함을 열 수 없어요.' : '물건함을 열지 못했어요. 연결을 확인해 주세요.'}</p>
        <button onClick={props.onRefresh}>물건함 다시 열기</button>
      </div>}
      {s.phase === 'ready' && s.model && (entry ? <ItemDetail entry={entry} props={props} assetHref={assetHref}/>
        : <InventoryIndex model={s.model} props={props} assetHref={assetHref}/>)}
    </div>
    {s.phase === 'ready' && entry && <ItemPager entry={entry} props={props}/>}
  </section>;
}
