// Fresh GetAccountSettings evidence only; never raises service quotas.
export function chooseConcurrency(limit) {
 const total=limit?.ConcurrentExecutions,available=limit?.UnreservedConcurrentExecutions;
 if(!Number.isInteger(total)||!Number.isInteger(available)||total<1||available<1||available>total)throw new Error('Unknown Lambda concurrency limits');
 if(available>=102)return {reservedConcurrency:2,accountCeiling:total};
 if(total<=10)return {reservedConcurrency:null,accountCeiling:total};
 throw new Error('Cannot safely reserve two executions with this account quota');
}
