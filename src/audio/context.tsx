import { createContext, useContext } from 'react';
import type { GameAudio } from './player.ts';
export const AudioContext = createContext<GameAudio | null>(null);
export const useGameAudio = () => useContext(AudioContext);
