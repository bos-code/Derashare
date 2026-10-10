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

// Icon + label; on narrow screens only the icon shows, so the label doubles as the accessible name.
function SideButton({
  icon,
  label,
  className,
  onClick,
}: {
  icon: string;
  label: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button className={className} onClick={onClick} aria-label={label} title={label}>
      <span className="icon" aria-hidden="true">
        {icon}
      </span>
      <span className="label">{label}</span>
    </button>
  );
}

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
        <SideButton
          icon={dark ? "☀" : "☾"}
          label={dark ? "Light mode" : "Dark mode"}
          onClick={onToggleTheme}
        />
        {"Notification" in globalThis && (
          <SideButton icon="🔔" label="Notifications" onClick={onEnableNotifications} />
        )}
        {room && <SideButton icon="✕" label="Leave room" className="danger" onClick={onLeave} />}
      </div>
      <small className="privacy">
        Peer-to-peer files
        <br />
        No permanent storage
      </small>
    </aside>
  );
}
