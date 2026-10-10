import { useCallback, useState } from "react";

export type TextEntry = { id: number; direction: "sent" | "received"; text: string; at: number };

// Kept in memory only, like everything else in a room.
const MAX_ENTRIES = 10;
let entryCounter = 0;

export function useTextHistory() {
  const [entries, setEntries] = useState<TextEntry[]>([]);

  const add = useCallback((direction: TextEntry["direction"], text: string) => {
    setEntries((list) =>
      [{ id: ++entryCounter, direction, text, at: Date.now() }, ...list].slice(0, MAX_ENTRIES),
    );
  }, []);
  const clear = useCallback(() => setEntries([]), []);

  return { entries, add, clear };
}
