import { useEffect, useState } from "react";

import type { DailyMap } from "../generation/types.js";
import { Archive, type ArchiveStatus } from "./Archive.js";
import { loadArchive, loadDailyMap, loadDailyMapByDate, loadFreeMap, type ArchiveEntry } from "./api.js";
import { ExplorerKitControl } from "./ExplorerKitControl.js";
import { GameScreen, loadSavedState } from "./GameScreen.js";
import { playSound } from "./sfx.js";
import { SketchFrame } from "./SketchFrame.js";
import { useExplorerKit } from "./useExplorerKit.js";

type AppStage = "landing" | "game";

type Route =
  | { kind: "today" }
  | { kind: "date"; date: string }
  | { kind: "seed"; seed: string };

function currentRoute(): Route {
  const params = new URLSearchParams(location.search);
  const seed = params.get("seed");
  if (seed?.trim()) return { kind: "seed", seed: seed.trim() };
  const date = params.get("date");
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) return { kind: "date", date };
  return { kind: "today" };
}

const SEED_HEADS = [
  "nebulosa",
  "duna",
  "farol",
  "recife",
  "cume",
  "vereda",
  "estuário",
  "penhasco",
  "clareira",
  "arquipélago",
];
const SEED_TAILS = ["azul", "quieta", "antiga", "perdida", "lenta", "salgada", "aberta", "funda"];

/** Sorteio de interface, não de jogo: a regra de PRNG determinístico vale para gameplay. */
function rollSeed(): string {
  const head = SEED_HEADS[Math.floor(Math.random() * SEED_HEADS.length)];
  const tail = SEED_TAILS[Math.floor(Math.random() * SEED_TAILS.length)];
  return `${head}-${tail}-${Math.floor(Math.random() * 90) + 10}`;
}

function statusOf(mapId: string): ArchiveStatus {
  try {
    const raw = localStorage.getItem(`cruzaverso:save:${mapId}`);
    if (!raw) return "new";
    return (JSON.parse(raw) as { status?: string }).status === "won" ? "won" : "playing";
  } catch {
    return "new";
  }
}

function goTo(params: Record<string, string>) {
  const url = new URL(location.href);
  url.search = "";
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  location.assign(url);
}

export function App() {
  const [route] = useState<Route>(currentRoute);
  const [map, setMap] = useState<DailyMap | null>(null);
  const [stage, setStage] = useState<AppStage>("landing");
  const [error, setError] = useState<string | null>(null);
  const [entries, setEntries] = useState<ArchiveEntry[]>([]);
  const [seed, setSeed] = useState("");
  const { kit, updateKit } = useExplorerKit();

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const loader =
      route.kind === "seed"
        ? loadFreeMap(route.seed)
        : route.kind === "date"
          ? loadDailyMapByDate(route.date)
          : loadDailyMap();
    void loader
      .then((loaded) => {
        if (!cancelled) setMap(loaded);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "O atlas não respondeu.");
      });
    return () => {
      cancelled = true;
    };
  }, [route]);

  useEffect(() => {
    let cancelled = false;
    void loadArchive().then((loaded) => {
      if (!cancelled) setEntries(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function openGame() {
    if (!map) return;
    const storedVolume = Number(localStorage.getItem("cruzaverso:volume"));
    const volume = Number.isFinite(storedVolume) ? storedVolume : 0.65;
    playSound("open", localStorage.getItem("cruzaverso:sounds") === "off" ? 0 : volume);
    setStage("game");
  }

  if (stage === "game" && map) {
    return <GameScreen map={map} initialState={loadSavedState(map)} onBack={() => setStage("landing")} />;
  }

  const saved = map ? loadSavedState(map) : null;
  const isFree = map?.mode === "free";
  const coins = map ? map.objects.filter((object) => object.type === "coin").length : 0;
  const startLabel = !map
    ? route.kind === "seed"
      ? "Desenhando um mundo novo…"
      : "Desenhando o atlas…"
    : saved?.status === "won"
      ? "Rever expedição"
      : saved
        ? "Continuar expedição"
        : isFree
          ? "Explorar este mundo"
          : "Desbravar o mapa";

  return (
    <main className="landing-shell">
      <div className="landing-atlas" aria-hidden="true">
        <span className="landing-route route-one" />
        <span className="landing-route route-two" />
        <span className="landing-route route-three" />
        <span className="landing-route route-four" />
        <span className="landing-pin pin-one">✦</span>
        <span className="landing-pin pin-two">⌘</span>
      </div>
      <section className="landing-card has-sketch-frame" aria-labelledby="game-title">
        <SketchFrame seed="cartao-inicial" roughness={2.2} />
        <ExplorerKitControl kit={kit} onChange={updateKit} placement="landing" />
        <div className="logo-compass">✣</div>
        <p className="eyebrow">UM MUNDO NOVO, TODO DIA</p>
        <h1 id="game-title">Cruzaverso</h1>
        <p className="tagline">Um novo mundo se cruza todos os dias.</p>

        <div className="expedition-ticket">
          {isFree ? (
            <>
              <span>
                <small>EXPEDIÇÃO LIVRE</small>
                <strong>{route.kind === "seed" ? route.seed : "seed"}</strong>
              </span>
              <span className="ticket-divider" />
              <span>
                <small>MISSÃO</small>
                <strong>Recolher {coins} moedas</strong>
              </span>
            </>
          ) : (
            <>
              <span>
                <small>{route.kind === "date" ? "EXPEDIÇÃO DE" : "EXPEDIÇÃO DE HOJE"}</small>
                <strong>{route.kind === "date" ? route.date.split("-").reverse().join("/") : "Mapa Medium"}</strong>
              </span>
              <span className="ticket-divider" />
              <span>
                <small>MISSÃO</small>
                <strong>2 chaves + saída</strong>
              </span>
            </>
          )}
          <span className="ticket-divider" />
          <span>
            <small>PALAVRAS</small>
            <strong>{map ? map.words.length : "—"}</strong>
          </span>
        </div>

        {error ? (
          <div className="landing-error">
            <strong>O mapa ficou preso na névoa.</strong>
            <span>{error}</span>
            <button type="button" onClick={() => goTo({})}>
              Voltar para hoje
            </button>
          </div>
        ) : (
          <button className="start-button has-sketch-frame" type="button" disabled={!map} onClick={openGame}>
            <SketchFrame seed="botao-desbravar" roughness={1.4} />
            <span>{startLabel}</span>
            <i>→</i>
          </button>
        )}

        {route.kind === "today" ? null : (
          <button className="text-button" type="button" onClick={() => goTo({})}>
            ← voltar para a expedição de hoje
          </button>
        )}

        <p className="landing-note">Sem derrota, sem pressa. Seu tempo ativo aparece apenas no fim.</p>

        <div className="free-run">
          <label htmlFor="seed-input">ou explore um mundo livre</label>
          <div className="free-run-line">
            <input
              id="seed-input"
              value={seed}
              placeholder="ex.: nebulosa-42"
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setSeed(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && seed.trim()) goTo({ seed: seed.trim() });
              }}
            />
            <button type="button" aria-label="Sortear uma seed" title="Sortear uma seed" onClick={() => setSeed(rollSeed())}>
              🎲
            </button>
          </div>
          <button type="button" disabled={!seed.trim()} onClick={() => goTo({ seed: seed.trim() })}>
            Gerar expedição livre <i>→</i>
          </button>
          <small>Sem chave e sem saída: a expedição fecha quando a última moeda sai do chão. Um mundo inédito leva alguns segundos.</small>
        </div>

        <Archive entries={entries} statusOf={statusOf} onPick={(date) => goTo({ date })} />
      </section>
      <footer className="landing-footer">
        <span>PT-BR</span>
        <span>Seed diária · America/São_Paulo</span>
      </footer>
    </main>
  );
}
