import type { Status } from "@/hooks/useRoomSocket";

type Props = {
  status: Status;
  room: string;
  peerConnected: boolean;
  rtcReady: boolean;
  rtcFailed: boolean;
  dark: boolean;
  onToggleTheme: () => void;
  onEnableNotifications: () => void;
  onLeave: () => void;
};

export function Sidebar({
  status,
  room,
  peerConnected,
  rtcReady,
  rtcFailed,
  dark,
  onToggleTheme,
  onEnableNotifications,
  onLeave,
}: Props) {
  const title = room ? (status === "connected" ? "Connected" : "Connecting") : "Ready";
  const detail = !room
    ? "No active room"
    : !peerConnected
      ? "Waiting for device"
      : rtcReady
        ? "Files ready"
        : rtcFailed
          ? "Files unavailable"
          : "Preparing files";

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="mark">D</div>
        <div>
          <strong>Dera Share</strong>
          <span>Direct device sharing</span>
        </div>
      </div>
      <div className="sideStatus">
        <span className={`dot ${status}`} />
        <div>
          <strong>{title}</strong>
          <span>{detail}</span>
        </div>
      </div>
      {room && (
        <div className="sideRoom">
          <span>ROOM CODE</span>
          <strong>{room}</strong>
          <button onClick={() => navigator.clipboard.writeText(room)}>Copy</button>
        </div>
      )}
      <div className="sideActions">
        <button onClick={onToggleTheme}>{dark ? "☀ Light mode" : "☾ Dark mode"}</button>
        {"Notification" in globalThis && (
          <button onClick={onEnableNotifications}>Notifications</button>
        )}
        {room && (
          <button className="danger" onClick={onLeave}>
            Leave room
          </button>
        )}
      </div>
      <small className="privacy">
        Peer-to-peer files
        <br />
        No permanent storage
      </small>
    </aside>
  );
}
