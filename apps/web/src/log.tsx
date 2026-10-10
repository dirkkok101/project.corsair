import type { Hoard, WorldState } from "@corsair/core";
import { difficultyOf, isLand, tileAt } from "@corsair/data";
import type { ContentPack, DifficultyLevel, PlacedSettlement, TileMap } from "@corsair/data";
import { CareerCard } from "./career";
import { hoardRing } from "@corsair/systems-economy";
import type { Goal } from "@corsair/systems-traffic";
import { useEffect, useRef, useState } from "preact/hooks";
import { TopTen } from "./port";

/** The parchment's size on screen, in pixels. */
const PARCHMENT_PX = 216;

/** Pieces held before the X itself is drawn on the map. */
const X_AT_PIECES = 3;

/**
 * The order a map's quarters come in, by its pieces: the quarter the hoard lies in first, so one piece already shows
 * the coast to read (the X itself only from the third piece), then its neighbours, the far side last (quarters: 0
 * top left, 1 top right, 2 bottom left, 3 bottom right of the widest search ring).
 */
function quartersHeld(hoard: Hoard, pieces: number): number[] {
  const xq = (hoard.dx <= 0 ? 1 : 0) + (hoard.dy <= 0 ? 2 : 0);
  return [xq, xq ^ 1, xq ^ 2, 3 - xq].slice(0, pieces);
}

/**
 * A hoard's map drawn as a parchment from the real coast about the widest search ring: land, water and the shore
 * between; the quarters not yet held torn away; the X from the third piece.
 */
function Parchment({
  content,
  map,
  hoard,
  pieces,
}: {
  content: ContentPack;
  map: TileMap;
  hoard: Hoard;
  pieces: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx) return;
    const cx = hoard.x + hoard.dx;
    const cy = hoard.y + hoard.dy;
    const r = (content.treasure.ringTiles[0]! / 2) * 1.3;
    const perTile = PARCHMENT_PX / (2 * r);
    const held = new Set(quartersHeld(hoard, pieces));
    const half = PARCHMENT_PX / 2;
    const land = (x: number, y: number) => isLand(tileAt(map, x, y));
    ctx.clearRect(0, 0, PARCHMENT_PX, PARCHMENT_PX);
    for (let py = 0; py < PARCHMENT_PX; py += 2) {
      for (let px = 0; px < PARCHMENT_PX; px += 2) {
        const q = (px >= half ? 1 : 0) + (py >= half ? 2 : 0);
        if (!held.has(q)) continue;
        const tx = cx - r + px / perTile;
        const ty = cy - r + py / perTile;
        const here = land(tx, ty);
        const shore =
          here &&
          (!land(tx + 0.6, ty) ||
            !land(tx - 0.6, ty) ||
            !land(tx, ty + 0.6) ||
            !land(tx, ty - 0.6));
        ctx.fillStyle = shore ? "#5e4024" : here ? "#a8834e" : "#e2cfa3";
        ctx.fillRect(px, py, 2, 2);
      }
    }
    if (pieces >= X_AT_PIECES) {
      const x = (hoard.x - cx + r) * perTile;
      const y = (hoard.y - cy + r) * perTile;
      ctx.strokeStyle = "#a53030";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 6);
      ctx.lineTo(x + 6, y + 6);
      ctx.moveTo(x + 6, y - 6);
      ctx.lineTo(x - 6, y + 6);
      ctx.stroke();
    }
  }, [hoard, pieces]);
  return (
    <canvas
      ref={ref}
      class="parchment"
      width={PARCHMENT_PX}
      height={PARCHMENT_PX}
    />
  );
}

/** The water nearest a spot, ring by ring outward: a course goes to the search ring, never straight to the X. */
function waterNear(map: TileMap, x: number, y: number): [number, number] {
  for (let d = 0; d < 40; d++) {
    for (let k = 0; k < Math.max(1, d * 8); k++) {
      const a = (k / Math.max(1, d * 8)) * Math.PI * 2;
      const wx = x + Math.sin(a) * d;
      const wy = y - Math.cos(a) * d;
      if (!isLand(tileAt(map, wx, wy))) return [wx, wy];
    }
  }
  return [x, y];
}

export interface LogProps {
  content: ContentPack;
  state: WorldState;
  map: TileMap;
  settlements: PlacedSettlement[];
  /** Plot a course to a spot at sea (tile coordinates). */
  plot: (x: number, y: number) => void;
  close: () => void;
  /** The career's goals (careerGoals), in order. */
  goals: Goal[];
}

/** The next three goals not yet done, each with its progress and one click to where it gets done; the done below. */
function Goals({
  goals,
  settlements,
  plot,
  open,
  level,
}: {
  goals: Goal[];
  settlements: PlacedSettlement[];
  plot: LogProps['plot'];
  open: (page: 'top' | 'maps') => void;
  level: DifficultyLevel;
}) {
  const next = goals.filter((g) => !g.done).slice(0, 3);
  const done = goals.filter((g) => g.done);
  const port = (id?: string) => settlements.find((s) => s.id === id);
  return (
    <div class="goals">
      {next.length ? (
        next.map((g) => {
          const where = port(g.port);
          return (
            <div key={g.id} class="goal">
              <div class="log-map-title">{g.title}</div>
              <div class="goal-bar">
                <span style={{ width: `${Math.round(Math.min(1, g.have / Math.max(1, g.of)) * 100)}%` }} />
              </div>
              <div class="port-sub">
                {g.unit ? `${g.have.toLocaleString()} / ${g.of.toLocaleString()} ${g.unit} · ` : ''}
                {g.why}
              </div>
              {where ? (
                <button onClick={() => plot(where.x, where.y)}>Plot a course to {where.name}</button>
              ) : g.page ? (
                <button onClick={() => open(g.page!)}>{g.page === 'top' ? 'See the Top Ten' : 'See your maps'}</button>
              ) : null}
            </div>
          );
        })
      ) : (
        <p class="tavern-quiet">Every goal is done: a career to be proud of.</p>
      )}
      {done.length ? <div class="port-sub goals-done">Done: {done.map((g) => g.title).join(' · ')}</div> : null}
      <div class="port-sub goals-done">
        Difficulty: {level.name}. {level.about}
      </div>
    </div>
  );
}

/** The captain's log (L): the Top Ten, and the treasure maps she holds pieces of. */
export function Log({
  content,
  state,
  map,
  settlements,
  plot,
  close,
  goals,
}: LogProps) {
  const pieces = state.captain?.mapPieces ?? {};
  const maps = content.pirates.captains.flatMap((c) => {
    const hoard = state.famous?.[c.id]?.hoard;
    return pieces[c.id] && hoard ? [{ c, hoard, held: pieces[c.id]! }] : [];
  });
  const [page, setPage] = useState<"goals" | "career" | "top" | "maps">("goals");
  const name = (id: string) => settlements.find((s) => s.id === id)?.name ?? id;
  const whole = content.pirates.rules.mapPieces;
  return (
    <div class="log">
      <div class="log-panel">
        <div class="log-head">
          <span class="port-name">Captain's log</span>
          <nav class="log-tabs">
            <button
              class={page === "goals" ? "active" : ""}
              onClick={() => setPage("goals")}
            >
              Goals
            </button>
            <button
              class={page === "career" ? "active" : ""}
              onClick={() => setPage("career")}
            >
              Career
            </button>
            <button
              class={page === "top" ? "active" : ""}
              onClick={() => setPage("top")}
            >
              Top Ten
            </button>
            <button
              class={page === "maps" ? "active" : ""}
              onClick={() => setPage("maps")}
            >
              Maps{maps.length ? ` (${maps.length})` : ""}
            </button>
          </nav>
          <button class="leave" onClick={close}>
            Close · L
          </button>
        </div>
        {page === "goals" ? (
          <Goals goals={goals} settlements={settlements} plot={plot} open={setPage} level={difficultyOf(content, state.difficulty)} />
        ) : page === "career" ? (
          <CareerCard content={content} state={state} />
        ) : page === "top" ? (
          <TopTen content={content} state={state} settlements={settlements} />
        ) : maps.length ? (
          <div class="log-maps">
            {maps.map(({ c, hoard, held }) => {
              const ring = hoardRing(content, hoard, held);
              return (
                <div key={c.id} class="log-map">
                  <Parchment
                    content={content}
                    map={map}
                    hoard={hoard}
                    pieces={held}
                  />
                  <div>
                    <div class="log-map-title">{c.name}'s hoard</div>
                    <div class="port-sub">
                      {held} of {whole} pieces ·{" "}
                      {hoard.found
                        ? `${hoard.value.toLocaleString()} gold dug up`
                        : `about ${hoard.value.toLocaleString()} gold buried`}{" "}
                      · on the coast near {name(hoard.near)}
                    </div>
                    {hoard.found ? (
                      <p class="plunder-note">Dug up: the gold is yours.</p>
                    ) : (
                      <>
                        <p class="plunder-note">
                          {held >= 2 ? `The map marks ${hoard.landmark}. ` : ""}
                          The chart rings the search: about{" "}
                          {Math.round(ring.r * 2)} tiles across
                          {held < whole
                            ? ", narrowing with each piece you find"
                            : ""}
                          .
                          {held < X_AT_PIECES
                            ? " The hoard lies on the coast this piece shows; a third piece marks the X."
                            : ""}
                        </p>
                        <p class="plunder-note">
                          Close the shore inside the ring and press G to go
                          ashore and dig: half a day each time.
                        </p>
                        <button
                          onClick={() =>
                            plot(...waterNear(map, ring.x, ring.y))
                          }
                        >
                          Plot a course to the search ring
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p class="tavern-quiet">
            You hold no treasure maps. Take a famous pirate and ask about his
            hoard, pick up his men when he sinks, or look for the shady stranger
            in the taverns.
          </p>
        )}
      </div>
    </div>
  );
}
