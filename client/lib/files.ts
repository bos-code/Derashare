export const CHUNK_SIZE = 64 * 1024;
export const MAX_FILE_SIZE = 500 * 1024 * 1024;

export type Transfer = {
  name: string;
  size: number;
  progress: number;
  direction: "send" | "receive";
  url?: string;
  type?: string;
};

// Messages sent over the WebRTC data channel alongside the binary chunks.
export type FileMeta = { kind: "file-meta"; name: string; size: number; fileType: string };
export type FileEnd = { kind: "file-end" };

// Only these image types may be previewed; everything else is stored as an opaque download so a peer
// can't make the app render HTML/SVG from a same-origin blob: URL.
const IMAGE_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
};
const PREVIEWABLE = new Set(Object.values(IMAGE_TYPES));

export function safeFileType(name: string, type: unknown) {
  if (typeof type === "string" && PREVIEWABLE.has(type)) return type;
  if (!type) {
    const ext = name.split(".").pop()?.toLowerCase() || "";
    if (IMAGE_TYPES[ext]) return IMAGE_TYPES[ext];
  }
  return "application/octet-stream";
}

export function isPreviewable(transfer: Transfer) {
  return Boolean(transfer.url) && PREVIEWABLE.has(transfer.type || "");
}

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}
