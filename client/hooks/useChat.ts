import { useCallback, useEffect, useState } from "react";

export type ChatEntry = { id: number; mine: boolean; text: string; at: number };

// In memory only; cleared when the room is left.
const MAX_MESSAGES = 200;
let messageCounter = 0;

export function useChat() {
  const [messages, setMessages] = useState<ChatEntry[]>([]);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);

  const add = useCallback(
    (mine: boolean, text: string) => {
      setMessages((list) =>
        [...list, { id: ++messageCounter, mine, text, at: Date.now() }].slice(-MAX_MESSAGES),
      );
      if (!mine && !open) setUnread((n) => n + 1);
    },
    [open],
  );

  useEffect(() => {
    if (open) setUnread(0);
  }, [open]);

  const clear = useCallback(() => {
    setMessages([]);
    setUnread(0);
    setOpen(false);
  }, []);

  return { messages, open, setOpen, unread, add, clear };
}
