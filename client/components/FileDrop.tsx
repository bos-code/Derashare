import { useRef } from "react";

type Props = { rtcReady: boolean; rtcFailed: boolean; onFiles: (files: FileList | null) => void };

export function FileDrop({ rtcReady, rtcFailed, onFiles }: Props) {
  const input = useRef<HTMLInputElement | null>(null);

  return (
    <div
      className="fileZone"
      onClick={() => input.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        onFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        hidden
        multiple
        type="file"
        onChange={(e) => {
          onFiles(e.target.files);
          e.currentTarget.value = "";
        }}
      />
      <div className="fileIcon">↑</div>
      <strong>
        {rtcReady
          ? "Choose any file"
          : rtcFailed
            ? "File sharing unavailable on this network"
            : "File sharing is preparing…"}
      </strong>
      <span>Images · documents · archives · audio · video · up to 500 MB</span>
    </div>
  );
}
