// A game controller (the browser's standard mapping: an Xbox or PlayStation pad) plays as the keyboard does: each
// button press is the key it stands for, sent as a key press, so every screen that answers a key answers the pad
// with no code of its own. The left stick and the D-pad steer and trim the sails as A/D and W/S do.

/** Where the captain is: the same button means what that screen's key means (A acts at sea, fires in battle, confirms in port). */
export type PadContext = 'sea' | 'port' | 'battle';

/** Each button (standard mapping index) and the keys it presses, in order; a key no screen wants does nothing. */
const BUTTONS: Record<number, (at: PadContext) => string[]> = {
  0: (at) => [at === 'port' ? 'Enter' : ' '], // A: the one thing to do now; fire in battle; close a letter in port
  1: () => ['Escape'], // B: back, let her go, part ways
  2: () => ['g', 'f'], // X: board in battle; attack in a hail
  3: (at) => [at === 'port' ? 'e' : 'r'], // Y: set sail from port; repel boarders
  4: () => ['Tab'], // LB: the next ship in sight; the next shot in battle
  5: () => ['c'], // RB: the camera overhead or astern
  6: () => ['s'], // LT: less sail
  7: () => ['w'], // RT: more sail
  // Back: the chart; in battle, strike your colours when called on (never on a button pressed in a fight's heat).
  8: (at) => [at === 'battle' ? 'y' : 'm'],
  // Start: the log; in battle, take the plunder (Enter) when it is won.
  9: (at) => [at === 'battle' ? 'Enter' : 'l'],
  12: () => ['w'], // D-pad up
  13: () => ['s'], // D-pad down
};
/** The triggers are read by how far they are pulled, not their own pressed flag, which trips at a touch. */
const TRIGGERS = new Set([6, 7]);
/** The stick past this steers; the triggers past this count as pressed. */
const DEAD = 0.5;

const press = (key: string, type: 'keydown' | 'keyup') => window.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true }));

/** `pressed` is told of every button pressed (the first input unlocks the sound). */
export function createGamepad(pressed: () => void = () => {}) {
  const down = new Set<number>();
  let steer: 'a' | 'd' | undefined;
  // The keyboard forgets keys held when the window loses focus: so does the stick, to steer again on return.
  window.addEventListener('blur', () => (steer = undefined));
  return {
    /** Read the first pad connected, once a frame, and press or release the keys its buttons and stick stand for. */
    poll(at: PadContext) {
      const pad = navigator.getGamepads?.().find((p) => p?.mapping === 'standard') ?? undefined;
      if (!pad) return;
      for (const [i, keys] of Object.entries(BUTTONS)) {
        const n = Number(i);
        const b = pad.buttons[n];
        const on = Boolean(b && (TRIGGERS.has(n) ? b.value > DEAD : b.pressed));
        if (on && !down.has(n)) {
          down.add(n);
          pressed();
          for (const k of keys(at)) press(k, 'keydown');
        } else if (!on && down.has(n)) {
          down.delete(n);
          for (const k of keys(at)) press(k, 'keyup');
        }
      }
      // The stick or the D-pad held over steers, as A or D held.
      const x = pad.axes[0] ?? 0;
      const want = x < -DEAD || pad.buttons[14]?.pressed ? 'a' : x > DEAD || pad.buttons[15]?.pressed ? 'd' : undefined;
      if (want !== steer) {
        if (steer) press(steer, 'keyup');
        if (want) press(want, 'keydown');
        steer = want;
      }
    },
  };
}
