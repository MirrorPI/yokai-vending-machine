import type { ExecutionStatus } from '../runtime/execution.ts';
import type { ObservationPhase } from './session.ts';

export function observationNotice(input: {phase?:ObservationPhase;status?:ExecutionStatus;busy?:boolean;preparationFailed?:boolean}) {
  if(input.busy)return null;
  if(input.preparationFailed)return {message:'손님 그림을 불러오지 못했어요. 연결을 확인해 주세요.',action:'손님 다시 불러오기'};
  if(input.phase==='preparing'||!input.phase)return null;
  if(input.phase==='unavailable')return {message:'관찰을 시작하지 못했어요. 연결 상태를 확인한 뒤 다시 눌러 주세요.',action:'관찰 다시 시작'};
  if(input.status?.state!=='blocked')return null;
  if(input.status.reason==='authority')return null;
  if(input.status.reason==='displaced')return     {message:'다른 창에서 이 계정의 관찰을 시작했어요. 여기서 계속하려면 아래를 눌러 주세요.',action:'이 창에서 관찰하기'};
  if(input.status.reason==='invalid')return {message:'이 방문을 이어갈 수 없어요. 저장된 기록을 확인하고 게임을 다시 시작해 주세요.',action:'게임 계속하기'};
  if(input.status.reason==='conflict')return {message:'다른 저장 작업과 겹쳤어요. 최신 기록을 확인한 뒤 이어갈게요.',action:'저장 다시 확인'};
  if(input.status.reason==='corrupt'||input.status.reason==='unsupported-version')return {message:'저장 기록을 읽지 못했어요. 기록을 초기화하지 말고 설정에서 백업을 확인해 주세요.',action:'기록 다시 확인'};
  return {message:'저장 완료를 확인하지 못했어요. 연결이 돌아오면 아래 버튼으로 게임을 계속할 수 있어요.',action:'저장 확인하고 계속하기'};
}
