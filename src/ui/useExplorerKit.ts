import { useRef, useState } from "react";

import {
  parseExplorerKit,
  serializeExplorerKit,
  type ExplorerKit,
} from "../game/explorer-kit.js";

export const KIT_KEY = "cruzaverso:kit";

/**
 * O kit é o único estado que atravessa runs, e agora atravessa também telas: a
 * inicial e a expedição editam o mesmo instrumento. O ref existe porque a
 * concessão de agulha acontece dentro do reducer da run, longe do render.
 */
export function useExplorerKit(): {
  kit: ExplorerKit;
  kitRef: { current: ExplorerKit };
  updateKit: (next: ExplorerKit) => void;
} {
  const [kit, setKit] = useState<ExplorerKit>(() =>
    parseExplorerKit(localStorage.getItem(KIT_KEY)),
  );
  const kitRef = useRef(kit);
  kitRef.current = kit;

  function updateKit(next: ExplorerKit) {
    kitRef.current = next;
    setKit(next);
    localStorage.setItem(KIT_KEY, serializeExplorerKit(next));
  }

  return { kit, kitRef, updateKit };
}
