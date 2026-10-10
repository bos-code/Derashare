import { useMemo, useState } from "react";
import QRCode from "qrcode";

// Quiet zone around the code, in modules. Scanners need some blank border.
const MARGIN = 2;

function QrSvg({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    let d = "";
    for (let y = 0; y < modules.size; y++)
      for (let x = 0; x < modules.size; x++)
        if (modules.data[y * modules.size + x]) d += `M${x + MARGIN} ${y + MARGIN}h1v1h-1z`;
    return { size: modules.size + MARGIN * 2, path: d };
  }, [text]);

  // Always dark-on-light, even in dark mode: inverted codes don't scan reliably everywhere.
  return (
    <svg
      className="qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code for the room link"
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

export function joinLink(room: string) {
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", room);
  return url.toString();
}

type Props = { room: string; onError: (message: string) => void };

export function InviteCard({ room, onError }: Props) {
  const [copied, setCopied] = useState(false);
  const link = useMemo(() => joinLink(room), [room]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      onError("Could not copy the link automatically.");
    }
  };

  return (
    <div className="invite">
      <QrSvg text={link} />
      <div className="inviteText">
        <strong>Connect your other device</strong>
        <span>
          Scan this code with its camera, or enter room code <b>{room}</b>.
        </span>
        <button onClick={copy}>{copied ? "Link copied" : "Copy join link"}</button>
      </div>
    </div>
  );
}
