import type { Helm, SailSetting, Sim, Wind, WindStrength } from '@corsair/core';

const PORT_KEYS = new Set(['a', 'arrowleft']);
const STARBOARD_KEYS = new Set(['d', 'arrowright']);
const STRENGTHS: WindStrength[] = ['calm', 'light', 'fresh', 'strong', 'gale'];
const WIND_STEP_DEG = 22.5; // the PRD's 16 wind points
const SAILS: SailSetting[] = ['furled', 'half', 'full'];

/** Keyboard → commands. Helm is sent only when it changes, which keeps the input log small. */
/** `windHere` is the wind at the player's ship; the wind keys adjust it (debug). */
export function bindInput(sim: Sim, shipId: string, windHere: () => Wind): void {
  const held = new Set<string>();
  // Commands apply on the next tick, so two keys in one tick must build on what was sent, not on
  // state; otherwise the second wind key undoes the first. Once a tick passes, state is the truth
  // again (which also picks up changes made through the debug API).
  let helmSentAt = -1;
  let windSentAt = -1;
  let sailsSentAt = -1;
  let sentSails: SailSetting = 'full';
  let sentHelm: Helm = 0;
  let sentWind: Wind = windHere();
  const currentHelm = () =>
    sim.state.tick === helmSentAt ? sentHelm : (sim.state.ships[shipId]?.helm ?? 0);
  const currentWind = () => (sim.state.tick === windSentAt ? sentWind : windHere());
  const currentSails = () =>
    sim.state.tick === sailsSentAt ? sentSails : (sim.state.ships[shipId]?.sails ?? 'full');

  const sendWind = (wind: Wind) => {
    sentWind = wind;
    windSentAt = sim.state.tick;
    sim.send({ type: 'SetWind', ...wind });
  };

  const updateHelm = () => {
    const port = [...held].some((k) => PORT_KEYS.has(k));
    const starboard = [...held].some((k) => STARBOARD_KEYS.has(k));
    const next: Helm = port === starboard ? 0 : starboard ? 1 : -1;
    if (next === currentHelm()) return;
    sentHelm = next;
    helmSentAt = sim.state.tick;
    sim.send({ type: 'SetHelm', shipId, helm: next });
  };

  window.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    const wind = currentWind();
    if (key === '[' || key === ']') {
      sendWind({ fromDeg: (wind.fromDeg + (key === ']' ? WIND_STEP_DEG : -WIND_STEP_DEG) + 360) % 360, strength: wind.strength });
      return;
    }
    if (key === 'w' || key === 's' || key === 'arrowup' || key === 'arrowdown') {
      const i = SAILS.indexOf(currentSails()) + (key === 'w' || key === 'arrowup' ? 1 : -1);
      const sails = SAILS[Math.max(0, Math.min(SAILS.length - 1, i))]!;
      if (sails === currentSails()) return;
      sentSails = sails;
      sailsSentAt = sim.state.tick;
      sim.send({ type: 'SetSails', shipId, sails });
      return;
    }
    const strength = STRENGTHS[Number(key) - 1];
    if (strength) {
      sendWind({ fromDeg: wind.fromDeg, strength });
      return;
    }
    held.add(key);
    updateHelm();
  });
  window.addEventListener('keyup', (e) => {
    held.delete(e.key.toLowerCase());
    updateHelm();
  });
  window.addEventListener('blur', () => {
    held.clear();
    updateHelm();
  });
}
