import { ephemeralTemplate } from './ephemeral.mjs';
export function deploymentMode(args) {
 const ephemeral=args.includes('--ephemeral'),persistent=args.includes('--persistent');
 if(!args.includes('--apply')||ephemeral===persistent)throw new Error('No cloud action performed. Specify --apply and exactly one of --ephemeral or --persistent.');
 return {name:ephemeral?'ephemeral':'persistent',suffix:ephemeral?'test':'feedback',cleanup:ephemeral,
  template:ephemeral?ephemeralTemplate:t=>structuredClone(t),
  tags:runId=>[{Key:'Project',Value:'YokaiVending'},{Key:ephemeral?'EphemeralRun':'DeploymentRun',Value:runId},{Key:'Purpose',Value:ephemeral?'TemporaryTest':'Feedback15'}]};
}
