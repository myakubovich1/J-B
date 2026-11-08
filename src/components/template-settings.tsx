"use client";
import { useId, useState } from "react";
import { SlidersHorizontal, X } from "lucide-react";
import { defaultResumeSettings, type ResumeSettings } from "@/lib/resume-settings";
import { Button, Card, Field } from "./ui";

export function TemplateSettings({
  template,
  onSaved,
  onGenerate,
}: {
  template: { id: string; name: string; settings?: ResumeSettings };
  onSaved: () => void | Promise<unknown>;
  onGenerate?: () => Promise<unknown>;
}) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ResumeSettings>(template.settings || defaultResumeSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  async function persist(action: "save" | "reset", generate = false) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/resume-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          templateId: template.id,
          ...(action === "save" ? { settings: draft } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save layout settings.");
      setDraft(data.settings as ResumeSettings);
      await onSaved();
      if (generate && onGenerate) {
        await onGenerate();
        setOpen(false);
      } else
        setNotice(
          action === "reset"
            ? "Template defaults restored."
            : "Layout saved. New resumes will use these settings.",
        );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to save layout settings.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setDraft(template.settings || defaultResumeSettings);
          setError("");
          setNotice("");
          setOpen(true);
        }}
      >
        <SlidersHorizontal size={12} /> Layout settings
      </Button>
      {open && (
        <div className="modal-backdrop" onClick={() => setOpen(false)}>
          <Card
            className="max-h-[90vh] w-full max-w-xl overflow-auto p-6"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 id={titleId} className="font-serif text-2xl">
                  {template.name} layout
                </h2>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  Choose a readable layout for future resumes. Saved versions keep their original
                  PDF and source.
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Close template settings"
                onClick={() => setOpen(false)}
              >
                <X size={18} />
              </Button>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void persist("save");
              }}
            >
              <div className="form-grid">
                <Field label="Font family">
                  <select
                    className="input"
                    value={draft.font}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, font: event.target.value as ResumeSettings["font"] })
                    }
                  >
                    <option value="template">Template default</option>
                    <option value="serif">Serif</option>
                    <option value="sans">Sans serif</option>
                  </select>
                </Field>
                <Field label="Body font size">
                  <select
                    className="input"
                    value={draft.fontSize}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        fontSize: Number(event.target.value) as ResumeSettings["fontSize"],
                      })
                    }
                  >
                    <option value={10}>10 pt</option>
                    <option value={11}>11 pt</option>
                    <option value={12}>12 pt</option>
                  </select>
                </Field>
                <Field label="Page margins">
                  <select
                    className="input"
                    value={draft.marginInches}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        marginInches: Number(event.target.value) as ResumeSettings["marginInches"],
                      })
                    }
                  >
                    <option value={0.65}>0.65 in</option>
                    <option value={0.75}>0.75 in</option>
                    <option value={0.9}>0.90 in</option>
                  </select>
                </Field>
                <Field label="Spacing">
                  <select
                    className="input"
                    value={draft.spacing}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        spacing: event.target.value as ResumeSettings["spacing"],
                      })
                    }
                  >
                    <option value="compact">Compact</option>
                    <option value="comfortable">Comfortable</option>
                  </select>
                </Field>
                <Field label="Paper size">
                  <select
                    className="input"
                    value={draft.paper}
                    disabled={busy}
                    onChange={(event) =>
                      setDraft({ ...draft, paper: event.target.value as ResumeSettings["paper"] })
                    }
                  >
                    <option value="letter">US Letter</option>
                    <option value="a4">A4</option>
                  </select>
                </Field>
              </div>
              <p className="mt-4 text-xs text-[var(--muted)]">
                Generate a new resume to preview the compiled PDF. Content is trimmed when needed;
                your selected font size stays fixed.
              </p>
              {error && (
                <p role="alert" className="error-text mt-4">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mt-4 text-xs text-[var(--green)]">
                  {notice}
                </p>
              )}
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button type="submit" disabled={busy}>
                  Save layout
                </Button>
                {onGenerate && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void persist("save", true)}
                  >
                    Save & generate
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void persist("reset")}
                >
                  Restore defaults
                </Button>
              </div>
            </form>
          </Card>
        </div>
      )}
    </>
  );
}
