import { photoFamilyNames } from '../photos/shared.ts';
import type { Ref } from 'react';
import type { AssetFile } from '../data/catalog.ts';
import type { EncyclopediaSnapshot, PhotoView } from './controller.ts';
import { filterEntries, rarityNames, seasons } from './model.ts';
import type { Entry, Filter, RarityFilter, SlotState, PhotoSlot } from './model.ts';
import { formatCaptureTime } from './capture-time.ts';
import { RarityFilters } from './RarityFilters.tsx';

export const seasonNames: Record<string, string> = { spring: '봄', summer: '여름', autumn: '가을', winter: '겨울' };
const stateNames: Record<Entry['status'], string> = { unseen: '미촬영', trace: '흔적 발견', captured: '촬영 완료' };
const slotNames: Record<SlotState, string> = { empty: '미촬영', pending: '저장 중', failed: '저장 실패', saved: '촬영', legacy: '이전 사진' };
const photoNotes: Partial<Record<PhotoView['state'], string>> = {
  empty: '아직 이 계절에 찍은 사진이 없어요.',
  pending: '사진을 저장하고 있어요.',
  failed: '이 사진을 저장하지 못했어요. 같은 계절에 다시 촬영할 수 있어요.',
  loading: '사진을 불러오는 중…',
  missing: '사진 파일을 찾을 수 없어요. 촬영 기록은 남아 있어요.',
  unavailable: '사진을 불러오지 못했어요. 다시 열어 주세요.',
  mismatch: '촬영 기록과 일치하는 사진을 찾지 못했어요.',
  'full-missing': '이 사진에는 전체 장면이 없어요. 요괴 사진으로 돌아갈 수 있어요.',
  'decode-error': '사진을 표시할 수 없어요. 다시 열어 주세요.',
};
type Captured = Extract<Entry, { status: 'captured' }>;
const originNames: Record<string, string> = { western: '먼 나라', original: '숲의 이웃', kr: '한국', jp: '일본', both: '한국·일본', kr_jp: '한국·일본' };
const seasonLabel = (values: Entry['seasons']) => values.length === 4 ? '사계절' : values.map(s => seasonNames[s]).join(' · ');
const numberLabel = (n: number) => String(n).padStart(3, '0');
const directHref = (file: AssetFile) => file.publicPath;

export interface EncyclopediaViewProps {
  embedded?: boolean;
  snapshot: EncyclopediaSnapshot; dialogRef?: Ref<HTMLElement>; scrollRef?: Ref<HTMLDivElement>;
  assetHref?(file: AssetFile): string;
  /** Defaults to the player's local time zone. */
  timeZone?: string;
  onViewedRetry?(): void;
  onRarity?(rarity: RarityFilter): void;
  onClose(): void; onFilter(filter: Filter): void; onSelect(id: string | null): void;
  onPhoto(season: string): void; onFull(full: boolean): void; onRetry(): void; onRefresh(): void;
  onImageError(token: number): void;
  onOpenItem?(itemId: string): void;
}

function Timestamp({ value, timeZone }: { value: string; timeZone?: string }) {
  return <time dateTime={value}>{formatCaptureTime(value, timeZone)}</time>;
}

function Illustration({ entry, href }: { entry: Entry; href: (file: AssetFile) => string }) {
  return entry.status === 'captured' && entry.illustration
    ? <div className="encyclopedia-art"><img src={href(entry.illustration)} alt={`${entry.name} 일러스트`}/></div>
    : <div className="encyclopedia-neutral" role="img" aria-label={entry.status === 'captured' ? '요괴 그림 없음' : '아직 촬영하지 않은 요괴'}>
      <span aria-hidden="true">?</span><small>{entry.status === 'captured' ? '그림 없음' : '모습 미공개'}</small>
    </div>;
}

function Photos({ props, entry }: { props: EncyclopediaViewProps; entry: Captured }) {
  const { snapshot: s } = props;
  const allSlots = entry.cover && !entry.slots.some(slot => slot.season === entry.coverSeason) ? [...entry.slots, entry.cover] : entry.slots;
  const places = allSlots.some(slot => slot.family);
  const slots = places ? allSlots.filter(slot => slot.family) : allSlots;
  const slot = slots.find(slot => slot.season === s.season);
  const metadata = slot?.metadata;
  const loaded = s.photo.state === 'ready' && !!s.photo.url;
  const season = slot?.sceneSeason ? `${photoFamilyNames[slot.family!]} · ${seasonNames[slot.sceneSeason]}` : s.season ? seasonNames[s.season] ?? (metadata?.backgroundFamily ? `이전 원본 · ${photoFamilyNames[metadata.backgroundFamily]}` : '이전 사진 · 장소 정보 없음') : '계절';
  const retry = ['missing', 'unavailable', 'mismatch', 'decode-error'].includes(s.photo.state);
  const place = metadata?.backgroundFamily === 'forest' ? '숲속' : metadata?.backgroundFamily === 'hill' ? '별이 보이는 언덕' : null;
  const photoButton = (slot: PhotoSlot) => <button key={slot.season}
    data-photo-slot={slot.season} data-photo-state={slot.state} aria-pressed={slot.season === s.season} onClick={() => props.onPhoto(slot.season)}>
    {seasonNames[slot.sceneSeason ?? slot.metadata?.sceneSeason ?? slot.season.replace('legacy:', '')] ?? '이전 사진'}
    <small>{slotNames[slot.state]}</small>
  </button>;
  return <section className="encyclopedia-photo guide-section" aria-label="계절 사진">
    <div className="guide-section-title"><h4>{places ? '장소·계절 사진' : '계절 사진'}</h4>
      <span>{slots.length > 1 ? `${slots.filter(slot => slot.metadata).length} / ${slots.length}칸` : season}</span>
    </div>
    {places ? <div className="photo-place-groups">{(['forest', 'hill'] as const).map(family => {
      const group = slots.filter(slot => slot.family === family);
      if (!group.length) return null;
      return <div key={family} className="photo-place-group"><h5>{photoFamilyNames[family]}</h5>
        <div className="encyclopedia-slots" aria-label={`${photoFamilyNames[family]} 사진칸`}>{group.map(photoButton)}</div>
      </div>;
    })}</div> : slots.length > 1 && <div className="encyclopedia-slots" aria-label="계절 사진칸">{slots.map(photoButton)}</div>}
    <figure className="guide-photo-frame">
      {loaded ? <div className="encyclopedia-original"><img key={s.photo.token} src={s.photo.url}
        width={s.full ? 192 : 96} height={s.full ? 256 : 128} alt={`${entry.name} · ${season} ${s.full ? '전체 장면' : '요괴 사진'}`}
        onError={() => props.onImageError(s.photo.token)}/></div> : slot?.family && !metadata ? <div className="encyclopedia-neutral" role="img" aria-label="아직 이 장소에서 촬영하지 않았어요"><span aria-hidden="true">?</span><small>미촬영</small></div> : <Illustration entry={entry} href={props.assetHref ?? directHref}/>}
      <figcaption>
        <span>{season} · {loaded ? s.full ? '전체 장면' : '요괴 사진' : slot?.family && !metadata ? '미촬영' : entry.illustration ? '참고 그림' : '사진 보기'}</span>
        {metadata && <span className="guide-photo-date">촬영 시각 <Timestamp value={metadata.at} timeZone={props.timeZone}/></span>}
      </figcaption>
    </figure>
    {photoNotes[s.photo.state] && <p className="guide-note" role="status">{slot?.family && s.photo.state === 'empty' ? '아직 이 장소·계절에서 찍은 사진이 없어요.' : photoNotes[s.photo.state]}</p>}
    {metadata && <>
      <div className="encyclopedia-actions" aria-label="사진 구도">
        <button aria-pressed={!s.full} onClick={() => props.onFull(false)}>요괴 사진</button>
        <button aria-pressed={s.full} onClick={() => props.onFull(true)}>전체 장면</button>
        {retry && <button onClick={props.onRetry}>사진 다시 열기</button>}
      </div>
      {(place || metadata.sceneSeason || metadata.capturedGameSeason) && <dl className="guide-photo-meta">
        {metadata.captureCount && <div><dt>이 장소·계절 촬영</dt><dd>{metadata.captureCount}회</dd></div>}
        {place && <div><dt>촬영 장소</dt><dd>{place}</dd></div>}
        {metadata.sceneSeason && metadata.sceneSeason !== metadata.capturedGameSeason &&
          <div><dt>장면 계절</dt><dd>{seasonNames[metadata.sceneSeason]}</dd></div>}
        {metadata.capturedGameSeason && <div><dt>촬영 계절</dt><dd>{seasonNames[metadata.capturedGameSeason]}</dd></div>}
      </dl>}
    </>}
  </section>;
}

function EntryPager({ props, entry }: { props: EncyclopediaViewProps; entry: Entry }) {
  const { snapshot: s } = props;
  const entries = new Map(s.model?.entries.map(e => [e.id, e]));
  const visibleIds = s.model ? filterEntries(s.model, s.filter, s.rarity).map(e => e.id) : [];
  const order = (s.detailOrder ?? (visibleIds.includes(entry.id) ? visibleIds : [entry.id])).filter(id => entries.has(id));
  const index = order.indexOf(entry.id);
  const previous = index > 0 ? entries.get(order[index - 1]) : undefined;
  const next = index >= 0 ? entries.get(order[index + 1]) : undefined;
  return <nav className="encyclopedia-detail-pager collection-detail-pager" aria-label="요괴 넘기기">
      <button data-stone="back" disabled={!previous} aria-label={previous ? `이전 요괴: ${previous.name}` : '이전 요괴'}
        onClick={() => { if (previous) props.onSelect(previous.id); }}><span aria-hidden="true">‹ </span>이전</button>
      <span className="encyclopedia-detail-position" aria-label="현재 요괴 위치">{index >= 0 ? `${index + 1} / ${order.length}` : '1 / 1'}</span>
      <button data-stone="primary" disabled={!next} aria-label={next ? `다음 요괴: ${next.name}` : '다음 요괴'}
        onClick={() => { if (next) props.onSelect(next.id); }}>다음<span aria-hidden="true"> ›</span></button>
    </nav>;
}

function EntryDetail({ props, entry }: { props: EncyclopediaViewProps; entry: Entry }) {
  const { snapshot: s } = props;
  const item = entry.status !== 'unseen' ? entry.item : null;
  return <article className="encyclopedia-detail" data-rarity={entry.rarity}>
    <div className="guide-detail-nav"><button data-stone="back" onClick={() => props.onSelect(null)}>
      <span aria-hidden="true">‹ </span>목록으로</button><span className="guide-number">기록 {numberLabel(entry.no)}</span></div>
    <header className="guide-entry-heading">
      <h3 tabIndex={-1} data-detail-heading>{entry.name}</h3>
      <div className="guide-entry-meta"><span className="rarity-badge">{rarityNames[entry.rarity]}</span>
        <span>{seasonLabel(entry.seasons)}</span><span>{stateNames[entry.status]}</span></div>
    </header>
    {s.viewed === 'error' && <p className="guide-note" role="status">확인 표시를 저장하지 못했어요. <button onClick={props.onViewedRetry}>다시 저장</button></p>}
    {entry.status === 'captured' ? <>
      <Photos props={props} entry={entry}/>
      <section className="guide-section guide-story">
        <div className="guide-section-title"><h4>요괴 이야기</h4><span>{originNames[entry.origin] ?? entry.origin}</span></div>
        {entry.description && <p className="guide-story-lead">{entry.description}</p>}
        {entry.lore && <><h5>전해지는 이야기</h5><p>{entry.lore}</p></>}
        {entry.favoriteDrink && <dl><div><dt>즐겨 찾는 상품</dt><dd>{entry.favoriteDrink}</dd></div></dl>}
      </section>
    </> : <section className="guide-section guide-locked">
      <Illustration entry={entry} href={props.assetHref ?? directHref}/>
      <h4>{entry.status === 'trace' ? '물건을 남기고 갔어요' : '아직 사진이 없어요'}</h4>
      <p>자판기에 찾아왔을 때 직접 촬영하면 모습과 이야기가 기록돼요.</p>
    </section>}
    {item && <section className="encyclopedia-item guide-section">
      <div className="guide-section-title"><h4>남긴 물건</h4></div>
      <p className="guide-object-name">{item.name}</p><p>{item.description}</p>
      {props.onOpenItem && <button data-stone="primary" onClick={() => props.onOpenItem?.(item.id)}>물건함에서 보기</button>}
    </section>}
    {entry.status === 'captured' && <section className="guide-section">
      <div className="guide-section-title"><h4>관찰 기록</h4><span>촬영 {entry.capture.captureCount}회</span></div>
      <dl className="guide-photo-meta"><div><dt>첫 촬영</dt><dd><Timestamp value={entry.capture.firstCapturedAt} timeZone={props.timeZone}/></dd></div></dl>
    </section>}
  </article>;
}

function GuideIndex({ props, model }: { props: EncyclopediaViewProps; model: NonNullable<EncyclopediaSnapshot['model']> }) {
  const { snapshot: s } = props, { progress } = model;
  const visibleEntries = filterEntries(model, s.filter, s.rarity);
  const category = s.filter === 'all' ? '전체' : s.filter === 'common' ? '사계절' : seasonNames[s.filter];
  const rarity = s.rarity && s.rarity !== 'all' ? rarityNames[s.rarity] : '모든 등급';
  return <>
    <div className="guide-progress" aria-label="전체 촬영 진행률">
      {[['촬영한 요괴', progress.captured, progress.totalYokai], ['모은 사진', progress.photos, progress.totalPhotos]].map(([label, count, total]) =>
        <div key={label}><strong>{count}<small> / {total}</small></strong><span>{label}</span><progress aria-label={String(label)} value={Number(count)} max={Number(total)}/></div>
      )}
    </div>
    {Object.values(model.preserved).some(n => n > 0) && <p className="guide-note">이전 도감 기록은 보관 중이에요.</p>}
    <div className="guide-filters">
      <p className="guide-filter-label">등장 계절</p>
      <nav className="encyclopedia-filters" aria-label="등장 계절 필터">{(['all', 'common', ...seasons] as const).map(f =>
        <button key={f} aria-pressed={s.filter === f} onClick={() => props.onFilter(f)}>{f === 'all' ? '전체' : f === 'common' ? '사계절' : seasonNames[f]}</button>)}</nav>
      <p className="guide-filter-label">등급</p>
      <RarityFilters value={s.rarity} onChange={props.onRarity}/>
    </div>
    <div className="guide-results"><p className="encyclopedia-filter-count" role="status">{category} · {visibleEntries.length}종 · {rarity}</p>
      {visibleEntries.some(e => e.isNew) && <span>새 기록 먼저</span>}</div>
    {visibleEntries.length === 0 && <p className="guide-note">조건에 맞는 요괴가 없어요. 계절이나 등급을 바꿔 보세요.</p>}
    <div className="encyclopedia-grid">{visibleEntries.map(y => <button key={y.id} className="encyclopedia-card" data-rarity={y.rarity}
      data-new={y.isNew || undefined} data-entry={y.id} onClick={() => props.onSelect(y.id)}>
      <span className="guide-card-top"><span className="encyclopedia-number">{numberLabel(y.no)}</span>
        {y.isNew && <span className="collection-new">NEW</span>}</span>
      <span className="encyclopedia-portrait-frame">{y.status === 'captured' && y.illustration
        ? <img className="encyclopedia-portrait" src={(props.assetHref ?? directHref)(y.illustration)} alt={`${y.name} 모습`} loading="lazy" draggable={false}/>
        : <span className="encyclopedia-card-symbol" aria-hidden="true">?</span>}</span>
      <strong>{y.name}</strong>
      <span className="guide-card-tags"><span className="rarity-badge">{rarityNames[y.rarity]}</span><span>{seasonLabel(y.seasons)}</span></span>
      {y.status !== 'captured' && <small>{stateNames[y.status]}</small>}
    </button>)}</div>
  </>;
}

export function EncyclopediaView(props: EncyclopediaViewProps) {
  const { snapshot: s } = props, model = s.model;
  const entry = model?.entries.find(y => y.id === s.selectedId);
  return <section className="encyclopedia-panel field-guide" ref={props.dialogRef} role={props.embedded ? 'region' : 'dialog'}
    aria-label="도감" tabIndex={-1} data-capture-blocker>
    <header className="encyclopedia-header guide-header"><div><span>자판기 관찰 기록</span><h2>요괴 도감</h2></div>
      {<button onClick={props.onClose} aria-label="도감 닫기">닫기</button>}
    </header>
    <div className="encyclopedia-scroll guide-scroll" ref={props.scrollRef}>
      {s.phase === 'loading' && <p className="guide-note" role="status">도감을 여는 중…</p>}
      {s.phase === 'error' && <div className="guide-note" role="alert">
        <p>{s.error === 'corrupt' ? '저장된 도감을 읽을 수 없어요. 원본 기록은 보관돼 있어요.'
          : s.error === 'unsupported-version' ? '이 게임 버전에서는 저장된 도감을 열 수 없어요.'
          : '도감을 열지 못했어요. 연결을 확인하고 다시 열어 주세요.'}</p>
        <button onClick={props.onRefresh}>도감 다시 열기</button>
      </div>}
      {s.phase === 'ready' && model && (entry ? <EntryDetail props={props} entry={entry}/> : <GuideIndex props={props} model={model}/>)}
    </div>
    {s.phase === 'ready' && entry && <EntryPager props={props} entry={entry}/>}
  </section>;
}
