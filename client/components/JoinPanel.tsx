import { useState } from "react";
import type { Status } from "@/hooks/useRoomSocket";

type Props = {
  status: Status;
  busy: boolean;
  onCreate: () => void;
  onJoin: (code: string) => void;
  onError: (message: string) => void;
};

export function JoinPanel({ status, busy, onCreate, onJoin, onError }: Props) {
  const [code, setCode] = useState("");

  const join = () => {
    if (busy) return;
    const digits = code.replace(/\D/g, "").slice(0, 6);
    if (digits.length !== 6) {
      onError("Enter a 6-digit room code.");
      return;
    }
    onJoin(digits);
  };

  return (
    <div className="setup">
      <button className="primary big" onClick={() => !busy && onCreate()} disabled={busy}>
        {status === "connecting" ? "Connecting…" : "Create a room"}
      </button>
      <div className="divider">
        <span>or join an existing room</span>
      </div>
      <label>6-digit room code</label>
      <div className="joinRow">
        <input
          className="codeInput"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          onKeyDown={(e) => e.key === "Enter" && join()}
          placeholder="000000"
        />
        <button className="secondary" onClick={join} disabled={busy}>
          Join
        </button>
      </div>
    </div>
  );
}
