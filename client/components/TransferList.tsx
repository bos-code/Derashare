import type { Transfer } from "@/lib/files";
import { TransferCard } from "./TransferCard";

type Props = { transfers: Transfer[]; onClear: () => void };

export function TransferList({ transfers, onClear }: Props) {
  if (!transfers.length) return null;
  const busy = transfers.some((t) => t.status === "queued" || t.status === "active");

  return (
    <div className="transferList">
      <div className="transferListHead">
        <span>{transfers.length === 1 ? "1 file" : `${transfers.length} files`}</span>
        {!busy && <button onClick={onClear}>Clear</button>}
      </div>
      {transfers.map((t) => (
        <TransferCard key={t.id} transfer={t} />
      ))}
    </div>
  );
}
