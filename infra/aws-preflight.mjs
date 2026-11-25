import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { FreeTierClient, GetAccountPlanStateCommand } from '@aws-sdk/client-freetier';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { requireFreePlan } from './account-safety.mjs';

// Credentials follow the normal SDK chain. Never accept a hand-edited plan JSON.
export async function checkAwsAccount() {
  const freeTier = new FreeTierClient({ region: 'us-east-1' });
  const sts = new STSClient({ region: process.env.AWS_REGION || 'ap-northeast-2' });
  try {
    return await requireFreePlan({
      readPlan: () => freeTier.send(new GetAccountPlanStateCommand({})),
      readIdentity: () => sts.send(new GetCallerIdentityCommand({})),
    });
  } finally { freeTier.destroy(); sts.destroy(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await checkAwsAccount(), null, 2)); }
  catch (error) { console.error(`Preflight refused: ${error instanceof Error ? error.message : String(error)}`); process.exitCode = 1; }
}
