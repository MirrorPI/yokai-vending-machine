import { useSyncExternalStore } from 'react';
import type { OnboardingController } from './controller.ts';
export function OnboardingNotice({ controller }: { controller: OnboardingController }) {
  const guide = useSyncExternalStore(controller.subscribe, () => controller.snapshot);
  return <>
    {guide.hint && <p className="onboarding-note" data-capture-blocker role="status">요괴를 누르면 사진과 작은 물건이 남아요<br/>보지 못한 손님도 물건을 두고 가요</p>}
    {guide.pip && <p className="onboarding-note" data-capture-blocker role="status">항상 위에 띄우기로 같은 장면을 작은 창에서 볼 수 있어요.</p>}
  </>;
}
