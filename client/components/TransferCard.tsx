import { formatBytes, isPreviewable, type Transfer } from "@/lib/files";

export function TransferCard({ transfer }: { transfer: Transfer }) {
  const preview = isPreviewable(transfer);

  return (
    <div className="transfer">
      {preview && (
        <div className="imagePreview">
          {/* next/image can't optimise a local blob: URL, so a plain <img> is intended. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={transfer.url} alt={transfer.name} />
        </div>
      )}
      <div className="transferMeta">
        <strong>
          {transfer.direction === "send" ? "Sending" : "Received"}: {transfer.name}
        </strong>
        <span>
          {formatBytes(transfer.size)} · {transfer.progress}%
        </span>
      </div>
      <div className="progress">
        <i style={{ width: `${transfer.progress}%` }} />
      </div>
      {transfer.url && (
        <div className="transferActions">
          {preview && (
            <a href={transfer.url} target="_blank" rel="noreferrer">
              Open preview
            </a>
          )}
          <a href={transfer.url} download={transfer.name}>
            Download
          </a>
        </div>
      )}
    </div>
  );
}
