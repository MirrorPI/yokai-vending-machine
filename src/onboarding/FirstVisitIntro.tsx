import { IntroCutscene } from './IntroCutscene.tsx';
export function FirstVisitIntro({ onStart }: { onStart(): void }) {
  return <IntroCutscene onFinish={onStart}/>;
}
