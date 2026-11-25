import { createContext, useContext } from 'react';
import type { AccountSession } from './session.ts';
import type { GamePorts } from './remote.ts';
export const AccountContext=createContext<{session:AccountSession;ports:GamePorts|null}|null>(null);
export const useAccount=()=>useContext(AccountContext);
