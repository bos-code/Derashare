import { useEffect, useRef, useState } from "react";
import type { ChatEntry } from "@/hooks/useChat";
import { MAX_CHAT_LENGTH } from "@/lib/protocol";

type Props = {
  messages: ChatEntry[];
  open: boolean;
  unread: number;
  canSend: boolean;
  // True when messages go over the direct device-to-device channel rather than the server relay.
  direct: boolean;
  onOpenChange: (open: boolean) => void;
  onSend: (text: string) => boolean;
};

const time = (at: number) =>
  new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// A small, collapsed-by-default chat between the two devices. No toasts or sounds: new messages
// only show as a count on the button.
export function ChatBox({ messages, open, unread, canSend, direct, onOpenChange, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, open]);

  const send = () => {
    const text = draft.trim();
    if (!text || !canSend) return;
    if (onSend(text)) setDraft("");
  };

  if (!open)
    return (
      <button
        className="chatToggle"
        onClick={() => onOpenChange(true)}
        aria-label={unread ? `Chat, ${unread} unread` : "Chat"}
        title="Chat"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16v11H8l-4 4z" />
        </svg>
        {unread > 0 && <span className="chatBadge">{unread > 9 ? "9+" : unread}</span>}
      </button>
    );

  return (
    <section
      className="chatPanel"
      aria-label="Chat"
      onKeyDown={(e) => e.key === "Escape" && onOpenChange(false)}
    >
      <header>
        <div>
          <strong>Chat</strong>
          <span
            title={
              direct
                ? "Messages go straight to the other device."
                : "Messages pass through the server but are never stored."
            }
          >
            {direct ? "Direct" : "Via server"} · not saved
          </span>
        </div>
        <button onClick={() => onOpenChange(false)} aria-label="Close chat">
          ✕
        </button>
      </header>
      <div className="chatMessages" ref={listRef} aria-live="polite">
        {messages.length === 0 ? (
          <p className="chatEmpty">Messages disappear when you leave the room.</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`chatMsg ${m.mine ? "mine" : "theirs"}`}>
              <p>{m.text}</p>
              <time>{time(m.at)}</time>
            </div>
          ))
        )}
      </div>
      <form
        className="chatInput"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_CHAT_LENGTH}
          placeholder={canSend ? "Message" : "Waiting for the other device…"}
          disabled={!canSend}
          aria-label="Chat message"
        />
        <button type="submit" disabled={!canSend || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
