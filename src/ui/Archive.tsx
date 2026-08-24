import type { ArchiveEntry } from "./api.js";

export type ArchiveStatus = "won" | "playing" | "new";

interface ArchiveProps {
  entries: ArchiveEntry[];
  statusOf: (mapId: string) => ArchiveStatus;
  onPick: (date: string) => void;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const LABEL: Record<ArchiveStatus, string> = {
  won: "✓ concluída",
  playing: "◐ em andamento",
  new: "· nova",
};

function humanDate(date: string): string {
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? "";
  return `${date.slice(8, 10)} ${month}`;
}

export function Archive({ entries, statusOf, onPick }: ArchiveProps) {
  if (entries.length === 0) return null;
  return (
    <section className="archive" aria-labelledby="archive-title">
      <h2 id="archive-title">EXPEDIÇÕES ANTERIORES</h2>
      <ul>
        {entries.map((entry) => {
          const status = statusOf(entry.mapId);
          return (
            <li key={entry.date}>
              <button type="button" onClick={() => onPick(entry.date)}>
                <b>{humanDate(entry.date)}</b>
                <span>{entry.words} palavras</span>
                <i className={`archive-status is-${status}`}>{LABEL[status]}</i>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
