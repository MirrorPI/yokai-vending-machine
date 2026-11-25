import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/domain/state.ts';
import { applyCommand } from '../src/domain/commands.ts';
import { seasonProgress, chosenSeason } from '../src/domain/season-control.ts';
const record=()=>({firstCapturedAt:'2026-11-16T00:00:00Z',captureCount:1,photos:{},coverSeason:null});
function captured(n){const s=initialState();for(let i=1;i<=n;i++)s.discovered[`yokai_${String(i).padStart(3,'0')}`]=record();return s;}
test('unlock counts unique active species, not copies, unknown records or item traces',()=>{
 const s=captured(49);s.discovered.yokai_001.captureCount=900;s.discovered.unknown=record();
 assert.deepEqual(seasonProgress(s),{captured:49,total:102,required:50,unlocked:false});
 assert.equal(applyCommand(s,{type:'changeSettings',patch:{seasonMode:'fixed',fixedSeason:'winter'}}).status,'invalid');
 s.discovered.yokai_050=record();assert.equal(seasonProgress(s).unlocked,true);
 const result=applyCommand(s,{type:'changeSettings',patch:{seasonMode:'fixed',fixedSeason:'winter'}});
 assert.equal(result.status,'changed');assert.equal(chosenSeason(result.state),'winter');
 assert.deepEqual(result.state.discovered,s.discovered);assert.deepEqual(result.state.items,s.items);
});
test('legacy settings stay automatic and only valid complete fixed preferences are accepted',()=>{
 assert.equal(chosenSeason(initialState()),null);
 const s=captured(50);
 for(const patch of [{seasonMode:'fixed'},{seasonMode:'bad'},{fixedSeason:'moon'},{seasonMode:'fixed',fixedSeason:null}])assert.equal(applyCommand(s,{type:'changeSettings',patch}).status,'invalid');
 const fixed=applyCommand(s,{type:'changeSettings',patch:{seasonMode:'fixed',fixedSeason:'summer'}}).state;
 assert.equal(chosenSeason(applyCommand(fixed,{type:'changeSettings',patch:{seasonMode:'auto'}}).state),null);
});
