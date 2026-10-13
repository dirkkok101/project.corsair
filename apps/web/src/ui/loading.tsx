import { render } from 'preact';

// The loading screen (storyboard 1.1): one painting, a line of the period, and a rope that pays out as the game
// loads, so the game shows at once and the map's decoding and the 3D warm-up happen behind it.

/** A line of the period, one picked each time the game loads. */
const LINES = [
  'There is no peace beyond the line.',
  'The trade wind blows from the east, and trouble with it.',
  'Every port has its price, and every captain his.',
  'A full hold and a fair wind: a sailor asks no more.',
  'The Spanish Main is wide, and the King of Spain is far away.',
];

export interface Loading {
  /** How far along it is (0 to 1), and what it is doing. */
  progress(share: number, what: string): void;
  /** Fades away and is gone. */
  done(): void;
}

/** Shows the loading screen over `root` until `done`. */
export function showLoading(root: HTMLElement, painting: string | undefined): Loading {
  const host = root.appendChild(document.createElement('div'));
  const line = LINES[Math.floor(Math.random() * LINES.length)]!;
  const draw = (share: number, what: string, leaving = false) =>
    render(
      <div class={`loading${leaving ? ' leaving' : ''}`} style={painting ? { backgroundImage: `linear-gradient(rgb(8 10 16 / 0) 40%, rgb(8 10 16 / 0.55)), url(${painting})` } : undefined}>
        <h1 class="loading-title">Project Corsair</h1>
        <div class="loading-foot">
          <p class="loading-line">“{line}”</p>
          <div class="loading-rope" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)}>
            <span style={{ width: `${Math.round(Math.max(0.04, Math.min(1, share)) * 100)}%` }} />
          </div>
          <div class="loading-what">{what}</div>
        </div>
      </div>,
      host,
    );
  let last: [number, string] = [0, 'Charting the Main'];
  draw(...last);
  return {
    progress(share, what) {
      last = [share, what];
      draw(share, what);
    },
    done() {
      draw(1, last[1], true);
      setTimeout(() => {
        render(null, host);
        host.remove();
      }, 400);
    },
  };
}
