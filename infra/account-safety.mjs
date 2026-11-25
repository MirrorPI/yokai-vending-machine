// A pre-deployment eligibility check, not an AWS-wide billing hard cap.
export function evaluateAccountPlan(plan, identity, now = Date.now()) {
  const reasons = [];
  const account = identity?.Account;
  const remaining = plan?.accountPlanRemainingCredits;
  const expires = new Date(plan?.accountPlanExpirationDate ?? NaN).getTime();
  const reserveUsd = 20, minimumDays = 7;
  if (!Number.isFinite(now)) reasons.push('invalid-check-time');
  if (!/^[0-9]{12}$/.test(account ?? '') || account !== plan?.accountId) reasons.push('account-mismatch');
  if (plan?.accountPlanType !== 'FREE') reasons.push('free-plan-required');
  if (plan?.accountPlanStatus !== 'ACTIVE') reasons.push('active-plan-required');
  if (remaining?.unit !== 'USD' || typeof remaining?.amount !== 'number' || !Number.isFinite(remaining.amount)
      || remaining.amount <= reserveUsd) reasons.push('credit-reserve-required');
  const daysRemaining = (expires - now) / 86400000;
  if (!Number.isFinite(daysRemaining) || daysRemaining <= minimumDays) reasons.push('expiry-buffer-required');
  return { allowed: reasons.length === 0, reasons, reserveUsd, minimumDays,
    remainingCreditsUsd: Number.isFinite(remaining?.amount) ? remaining.amount : null,
    daysRemaining: Number.isFinite(daysRemaining) ? daysRemaining : null,
    expiresAt: Number.isFinite(expires) ? new Date(expires).toISOString() : null,
    checkedAt: Number.isFinite(now) ? new Date(now).toISOString() : null,
    planType: plan?.accountPlanType ?? 'UNKNOWN', accountSuffix: /^[0-9]{12}$/.test(account ?? '') ? account.slice(-4) : null };
}

export async function requireFreePlan({ readPlan, readIdentity, now = Date.now }) {
  const [plan, identity] = await Promise.all([readPlan(), readIdentity()]);
  const result = evaluateAccountPlan(plan, identity, now());
  if (!result.allowed) throw new Error(`AWS deployment blocked: ${result.reasons.join(', ')}`);
  return result;
}
