"use client";
import { useState } from "react";
import { ImagePlus, Download } from "lucide-react";

export function TemplateAssets({
  template,
  onSaved,
}: {
  template: { id: string; name: string; assets?: { name: string; size: number }[] };
  onSaved: () => void | Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function upload(files: FileList) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("templateId", template.id);
      for (const file of files) form.append("files", file);
      const response = await fetch("/api/template-assets", {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(30000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Image upload failed.");
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Image upload failed.");
    } finally {
      setBusy(false);
    }
  }
  const assets = template.assets || [];
  return (
    <div className="mt-4 border-t border-[var(--line)] pt-4 text-xs">
      <p className="font-medium">Supporting images</p>
      {assets.length ? (
        <>
          <ul className="mt-2 space-y-2">
            {assets.map((asset) => (
              <li key={asset.name}>
                <a
                  className="text-link"
                  href={`/api/template-assets?templateId=${encodeURIComponent(template.id)}&name=${encodeURIComponent(asset.name)}`}
                >
                  <Download size={12} /> {asset.name} · {Math.ceil(asset.size / 1024)} KB
                </a>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[var(--muted)]">
            Images are fixed for this template version. Upload a new template to replace them.
          </p>
        </>
      ) : (
        <>
          <p className="mt-2 text-[var(--muted)]">
            Add up to six PNG/JPEG images, 1 MB each and 3 MB total. Reference each as{" "}
            <code>assets/filename.png</code> in your source. Images are fixed once saved.
          </p>
          <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-[var(--green)] focus-within:outline focus-within:outline-2 focus-within:outline-offset-4">
            <ImagePlus size={14} />
            {busy ? "Saving images…" : "Upload supporting images"}
            <input
              className="sr-only"
              type="file"
              multiple
              accept="image/png,image/jpeg,.png,.jpg,.jpeg"
              aria-label={`Supporting images for ${template.name}`}
              disabled={busy}
              onChange={(event) => {
                const files = event.target.files;
                if (files?.length) void upload(files);
                event.target.value = "";
              }}
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="error-text mt-3">
          {error}
        </p>
      )}
      <p className="mt-3 text-[var(--muted)]">
        Custom templates and their images compile only in the isolated worker.
      </p>
    </div>
  );
}
