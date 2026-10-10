import { useState } from "react";
import type { TextEntry } from "@/hooks/useTextHistory";

type Props = { entries: TextEntry[]; onError: (message: string) => void };

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Recent text in both directions, newest first, each with its own copy button.
export function TextHistory({ entries, onError }: Props) {
  const [copied, setCopied] = useState<number | null>(null);
  if (!entries.length) return null;

  const copy = async (entry: TextEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopied(entry.id);
      setTimeout(() => setCopied((id) => (id === entry.id ? null : id)), 1200);
    } catch {
      onError("Could not copy automatically.");
    }
  };

  return (
    <div className="textHistory">
      <div className="receivedHead">
        <label>RECENT TEXT</label>
        <span>Last {entries.length} · this session only</span>
      </div>
      {entries.map((entry) => (
        <div
          key={entry.id}
          className={`historyItem ${entry.direction === "sent" ? "mine" : "theirs"}`}
        >
          <div className="historyMeta">
            <span>
              {entry.direction === "sent" ? "You sent" : "Received"} · {time(entry.at)}
            </span>
            <button onClick={() => copy(entry)}>{copied === entry.id ? "Copied" : "Copy"}</button>
          </div>
          <p>{entry.text}</p>
        </div>
      ))}
    </div>
  );
}
