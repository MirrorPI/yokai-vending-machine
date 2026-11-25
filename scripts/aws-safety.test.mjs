import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateAccountPlan, requireFreePlan } from '../infra/account-safety.mjs';

const now = Date.parse('2026-11-15T00:00:00Z');
const identity = { Account: '123456789012' };
const plan = () => ({ accountId: identity.Account, accountPlanType: 'FREE', accountPlanStatus: 'ACTIVE',
  accountPlanRemainingCredits: { amount: 80, unit: 'USD' }, accountPlanExpirationDate: new Date(now + 30 * 86400000) });

test('deployment refuses paid account even with promotional credits', () => {
  const result = evaluateAccountPlan({ ...plan(), accountPlanType: 'PAID' }, identity, now);
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.includes('free-plan-required'));
});
test('unknown, expired, account mismatch, insufficient reserve and near expiry fail closed', () => {
  for (const candidate of [null, {}, { ...plan(), accountPlanStatus: 'EXPIRED' },
    { ...plan(), accountId: '999999999999' }, { ...plan(), accountPlanRemainingCredits: { amount: 20, unit: 'USD' } },
    { ...plan(), accountPlanRemainingCredits: { amount: 90, unit: 'EUR' } },
    { ...plan(), accountPlanRemainingCredits: { amount: NaN, unit: 'USD' } },
    { ...plan(), accountPlanExpirationDate: new Date(now + 6 * 86400000) },
    { ...plan(), accountPlanExpirationDate: 'invalid' }]) {
    assert.equal(evaluateAccountPlan(candidate, identity, now).allowed, false);
  }
  assert.equal(evaluateAccountPlan(plan(), {}, now).allowed, false);
  assert.equal(evaluateAccountPlan(plan(), identity, NaN).allowed, false);
});
test('verified active free plan allows preparation with reserve and expiry evidence', () => {
  const result = evaluateAccountPlan(plan(), identity, now);
  assert.equal(result.allowed, true);
  assert.equal(result.remainingCreditsUsd, 80);
  assert.equal(result.reserveUsd, 20);
  assert.equal(result.daysRemaining, 30);
  assert.deepEqual(result.reasons, []);
});
test('preflight reads fresh provider evidence each invocation, never a caller supplied JSON approval', async () => {
  let reads = 0;
  const readPlan = async () => ({ ...plan(), accountPlanType: ++reads === 1 ? 'FREE' : 'PAID' });
  const readIdentity = async () => identity;
  assert.equal((await requireFreePlan({ readPlan, readIdentity, now: () => now })).allowed, true);
  await assert.rejects(requireFreePlan({ readPlan, readIdentity, now: () => now }), /free-plan-required/);
  assert.equal(reads, 2);
});
test('access failures never become permission to deploy', async () => {
  await assert.rejects(requireFreePlan({ readPlan: async () => { throw new Error('AccessDenied'); },
    readIdentity: async () => identity, now: () => now }), /AccessDenied/);
});
