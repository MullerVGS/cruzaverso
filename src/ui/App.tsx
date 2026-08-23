import { useEffect, useState } from "react";

import type { DailyMap } from "../generation/types.js";
import { loadDailyMap } from "./api.js";
import { GameScreen, loadSavedState } from "./GameScreen.js";
import { playSound } from "./sfx.js";

type AppStage = "landing" | "game";

function queryDate(): string | undefined {
  if (location.pathname !== "/debug") return undefined;
  return new URLSearchParams(location.search).get("date") ?? undefined;
}

export function App() {
  const [map, setMap] = useState<DailyMap | null>(null);
  const [stage, setStage] = useState<AppStage>("landing");
  const [error, setError] = useState<string | null>(null);
  const [debugDate, setDebugDate] = useState(queryDate() ?? "");
  const debugAvailable = location.pathname === "/debug" && import.meta.env.DEV;

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void loadDailyMap(queryDate())
      .then((dailyMap) => {
        if (!cancelled) setMap(dailyMap);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "O atlas não respondeu.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function openGame() {
    if (!map) return;
    playSound("open", localStorage.getItem("cruzaverso:sounds") !== "off");
    setStage("game");
  }

  function openDebugSeed() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(debugDate)) return;
    const url = new URL(location.href);
    url.searchParams.set("date", debugDate);
    location.assign(url);
  }

  if (stage === "game" && map) {
    return <GameScreen map={map} initialState={loadSavedState(map)} onBack={() => setStage("landing")} />;
  }

  const saved = map ? loadSavedState(map) : null;
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
      <section className="landing-card" aria-labelledby="game-title">
        <div className="logo-compass">✣</div>
        <p className="eyebrow">UM MUNDO NOVO, TODO DIA</p>
        <h1 id="game-title">Cruzaverso</h1>
        <p className="tagline">Um novo mundo se cruza todos os dias.</p>

        <div className="expedition-ticket">
          <span><small>EXPEDIÇÃO DE HOJE</small><strong>Mapa Medium</strong></span>
          <span className="ticket-divider" />
          <span><small>MISSÃO</small><strong>2 chaves + saída</strong></span>
          <span className="ticket-divider" />
          <span><small>PALAVRAS</small><strong>{map ? map.words.length : "—"}</strong></span>
        </div>

        {error ? (
          <div className="landing-error"><strong>O mapa ficou preso na névoa.</strong><span>{error}</span><button type="button" onClick={() => location.reload()}>Tentar novamente</button></div>
        ) : (
          <button className="start-button" type="button" disabled={!map} onClick={openGame}>
            <span>{!map ? "Desenhando o atlas…" : saved?.status === "won" ? "Rever expedição de hoje" : saved ? "Continuar expedição" : "Desbravar o mapa"}</span>
            <i>→</i>
          </button>
        )}
        <p className="landing-note">Sem derrota, sem pressa. Seu tempo ativo aparece apenas no fim.</p>

        {debugAvailable ? (
          <div className="debug-seed">
            <label htmlFor="debug-date">Ferramenta local · data/seed</label>
            <input id="debug-date" type="date" value={debugDate} onChange={(event) => setDebugDate(event.target.value)} />
            <button type="button" onClick={openDebugSeed}>Gerar</button>
          </div>
        ) : null}
      </section>
      <footer className="landing-footer"><span>PT-BR</span><span>Seed diária · America/São_Paulo</span></footer>
    </main>
  );
}
