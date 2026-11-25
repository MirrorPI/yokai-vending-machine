/** Original, quiet pentatonic score. No downloads, microphone or third-party audio. */
export class GameAudio {
  private context: AudioContext | null = null;
  private createContext: () => AudioContext;
  private music = false;
  private chime = false;
  private visible = true;
  private disposed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private nodes = new Map<OscillatorNode, { gain: GainNode; kind: 'music' | 'chime' }>();
  private arrivals = new Set<string>();
  private bar = 0;
  constructor(createContext: () => AudioContext = () => new AudioContext()) { this.createContext = createContext; }
  configure(settings: { sound: boolean; arrivalChime: boolean }) {
    this.music = settings.sound; this.chime = settings.arrivalChime;
    if (!this.music) this.stop('music');
    if (!this.chime) this.stop('chime');
    this.startMusic();
  }
  /** Call synchronously from a user gesture; rejected autoplay is never a game error. */
  async unlock() {
    if (this.disposed || (!this.music && !this.chime)) return;
    try {
      this.context ??= this.createContext();
      await this.context.resume();
      if (!this.disposed) this.startMusic();
    } catch { /* Unsupported or denied audio leaves gameplay available. */ }
  }
  setVisible(visible: boolean) {
    this.visible = visible;
    if (!visible) { this.stop('music'); this.stop('chime'); }
    else this.startMusic();
  }
  arrival(id: string) {
    if (this.disposed || this.arrivals.has(id)) return;
    this.arrivals.add(id);
    // Bound session memory while retaining recently recovered visits.
    if (this.arrivals.size > 256) this.arrivals.delete(this.arrivals.values().next().value!);
    if (!this.chime || !this.visible || this.context?.state !== 'running') return;
    [74,81,86].forEach((note,i) => this.note(note,i*.16,1.1,.045,'chime'));
  }
  private note(midi: number, delay: number, duration: number, volume: number, kind: 'music' | 'chime') {
    const ctx = this.context;
    if (!ctx || this.disposed) return;
    try {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain(), at = ctx.currentTime + delay;
      oscillator.type = 'sine'; oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
      gain.gain.setValueAtTime(.0001,at);
      gain.gain.exponentialRampToValueAtTime(volume,at+.025);
      gain.gain.exponentialRampToValueAtTime(.0001,at+duration);
      oscillator.connect(gain); gain.connect(ctx.destination);
      this.nodes.set(oscillator,{gain,kind});
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); this.nodes.delete(oscillator); };
      oscillator.start(at); oscillator.stop(at+duration+.03);
    } catch { /* Audio errors do not interrupt the observation loop. */ }
  }
  private startMusic() {
    if (this.disposed || this.timer !== null || !this.music || !this.visible || this.context?.state !== 'running') return;
    // Four slow phrases over D / G / B / A, a soft bell melody over warm bass.
    const phrases = [[74,78,81,78,76,74],[71,74,78,81,78,74],[71,76,78,83,81,78],[69,73,76,81,76,73]];
    const bar = this.bar++ % phrases.length;
    this.note([50,43,47,45][bar],0,5.8,.025,'music');
    phrases[bar].forEach((note,i) => this.note(note,i*.9,1.8,i%2 ? .018 : .028,'music'));
    this.timer = setTimeout(() => { this.timer = null; this.startMusic(); },5400);
  }
  private stop(kind: 'music' | 'chime') {
    if (kind === 'music' && this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    for (const [node,entry] of this.nodes) if (entry.kind === kind) {
      try { entry.gain.disconnect(); node.stop(); node.disconnect(); } catch { /* Already stopped. */ }
      this.nodes.delete(node);
    }
  }
  dispose() {
    this.disposed = true; this.stop('music'); this.stop('chime');
    void this.context?.close().catch(() => {}); this.context = null;
  }
}
