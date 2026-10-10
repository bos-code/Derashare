import { useState } from "react";
import { MAX_TEXT_LENGTH } from "@/lib/protocol";

type Props = {
  canSend: boolean;
  onSend: (text: string) => boolean;
  onError: (message: string) => void;
};

export function TextShare({ canSend, onSend, onError }: Props) {
  const [draft, setDraft] = useState("");

  const paste = async () => {
    try {
      setDraft(await navigator.clipboard.readText());
    } catch {
      onError("Clipboard permission was blocked. Paste manually.");
    }
  };

  const send = () => {
    if (!draft.trim()) return;
    if (onSend(draft)) setDraft("");
  };

  return (
    <>
      <div className="tabsTitle">SHARE TEXT</div>
      <div className="editor">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Paste or type something…"
          maxLength={MAX_TEXT_LENGTH}
        />
        <div className="editorActions">
          <button onClick={paste}>Paste</button>
          <span>
            {draft.length.toLocaleString()} / {MAX_TEXT_LENGTH.toLocaleString()}
          </span>
        </div>
      </div>
      <button className="primary send" disabled={!draft.trim() || !canSend} onClick={send}>
        Send text
      </button>
    </>
  );
}
