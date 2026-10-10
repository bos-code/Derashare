import { useState } from "react";

type Props = { text: string; onError: (message: string) => void };

export function ReceivedText({ text, onError }: Props) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      onError("Could not copy automatically.");
    }
  };

  return (
    <>
      <div className="receivedHead">
        <label>LATEST TEXT</label>
        <span>{text ? "Last text shared in this room" : "Nothing received yet"}</span>
      </div>
      <div className={`received ${!text ? "empty" : ""}`}>
        <pre>{text || "Incoming text will appear here."}</pre>
        {text && (
          <button className="copy" onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </>
  );
}
