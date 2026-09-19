"use client";

/** Saves `text` as a file from the browser (no server round-trip). */
export function DownloadTextButton({ text, filename, label = "Download" }: {
  text: string; filename: string; label?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }}
      className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-off-white"
    >
      {label}
    </button>
  );
}
