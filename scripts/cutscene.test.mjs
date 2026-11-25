import test from 'node:test';
import assert from 'node:assert/strict';
import {introCuts,introCutsceneId,hasSeenIntro} from '../src/onboarding/cutscene.ts';
import {initialState} from '../src/domain/state.ts';
test('five manually advanced cuts contain 10–12 seconds of motion',()=>{
 assert.equal(introCuts.length,5);
 assert.equal(new Set(introCuts.map(c=>c.id)).size,5);
 const duration=introCuts.reduce((n,c)=>n+c.durationMs,0);
 assert.ok(duration>=10000&&duration<=12000);
});
test('existing players see the new story independently of tutorial and old stories',()=>{
 const state=initialState();state.firstRunDone=true;state.viewedCutscenes={'old-intro':true};
 assert.equal(hasSeenIntro(state),false);
 state.viewedCutscenes[introCutsceneId]=true;
 assert.equal(hasSeenIntro(state),true);
 assert.equal(hasSeenIntro(initialState()),false);
});
