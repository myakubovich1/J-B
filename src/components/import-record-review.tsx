"use client";
import { useState } from "react";
import type { CandidateProfile, ImportedRecord, Source } from "@/lib/contracts";
import { importedRecordId, importedRecordIds } from "@/lib/import-draft";
import { Badge, Button, Field, Input } from "./ui";

const labels: Record<string, string> = {
  school: "School or institution",
  degree: "Degree",
  major: "Major / field of study",
  startDate: "Start date",
  endDate: "End / expected graduation date",
  gpa: "GPA (optional)",
  coursework: "Relevant coursework (optional)",
  company: "Company / organization",
  title: "Position title",
  location: "Location",
  bullets: "Experience bullets (one per line)",
  name: "Name",
  description: "Description",
  technologies: "Technologies (comma separated)",
  url: "Project URL (optional)",
  contribution: "Your own project contribution",
  text: "Accomplishment",
};
export function ImportRecordReview({
  source,
  profile,
  onApply,
}: {
  source: Source;
  profile: CandidateProfile;
  onApply: (records: ImportedRecord[]) => void;
}) {
  const [records, setRecords] = useState(source.structured?.records || []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const existing = importedRecordIds(profile);
  if (!source.structured) return null;
  const change = (id: string, field: string, value: string) => {
    setRecords((prior) =>
      prior.map((record) =>
        record.id === id ? { ...record, fields: { ...record.fields, [field]: value } } : record,
      ),
    );
    setConfirmed(false);
  };
  return (
    <section className="import-record-review" aria-label="Structured profile records">
      <h3>Review the profile records</h3>
      <p className="helper-text">
        These fields come from your document. Check the wording and dates, edit anything needed, and
        confirm your own contribution. Nothing is added automatically.
      </p>
      {source.structured.issues.map((issue) => (
        <p key={issue} className="notice">
          {issue}
        </p>
      ))}
      {records.map((record, index) => {
        const alreadyAdded = existing.has(importedRecordId(source.id, record.id));
        return (
          <CardRecord
            key={record.id}
            record={record}
            index={index}
            selected={selected.has(record.id)}
            alreadyAdded={alreadyAdded}
            toggle={() => {
              setSelected((old) => {
                const next = new Set(old);
                next.has(record.id) ? next.delete(record.id) : next.add(record.id);
                return next;
              });
              setConfirmed(false);
              setAdded(false);
            }}
            change={(field, value) => change(record.id, field, value)}
          />
        );
      })}
      {!!records.length && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            I reviewed the selected fields and confirm that they accurately describe my own
            education, experience, skills, and contributions.
          </label>
          <Button
            disabled={!confirmed || !selected.size}
            onClick={() => {
              try {
                onApply(
                  records.filter(
                    (record) =>
                      selected.has(record.id) &&
                      !existing.has(importedRecordId(source.id, record.id)),
                  ),
                );
                setSelected(new Set());
                setConfirmed(false);
                setError("");
                setAdded(true);
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : "Review the selected fields.");
              }
            }}
          >
            Add reviewed records to profile draft
          </Button>
          {added && (
            <p role="status" className="notice">
              Added to your profile draft. Close this source and save your profile to keep these
              records.
            </p>
          )}
          {error && (
            <p role="alert" className="error-text">
              {error}
            </p>
          )}
        </>
      )}
    </section>
  );
}
function CardRecord({
  record,
  index,
  selected,
  alreadyAdded,
  toggle,
  change,
}: {
  record: ImportedRecord;
  index: number;
  selected: boolean;
  alreadyAdded: boolean;
  toggle: () => void;
  change: (field: string, value: string) => void;
}) {
  return (
    <div className="import-record-card">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={selected}
          disabled={alreadyAdded}
          onChange={toggle}
          aria-label={`Select ${record.kind} record ${index + 1}`}
        />
        <strong>
          {record.fields.school ||
            record.fields.company ||
            record.fields.name ||
            record.fields.text ||
            `Record ${index + 1}`}
        </strong>
        <Badge tone={alreadyAdded ? "green" : "orange"}>
          {alreadyAdded ? "In your profile draft" : record.kind}
        </Badge>
      </label>
      <details>
        <summary>Review {record.kind} fields</summary>
        <div className="form-grid">
          {Object.entries(record.fields).map(([field, value]) => (
            <Field key={field} label={labels[field] || field}>
              {["bullets", "description", "contribution", "text", "coursework"].includes(field) ? (
                <textarea
                  className="input"
                  value={value}
                  maxLength={4000}
                  rows={3}
                  disabled={alreadyAdded}
                  onChange={(event) => change(field, event.target.value)}
                />
              ) : (
                <Input
                  value={value}
                  maxLength={4000}
                  disabled={alreadyAdded}
                  onChange={(event) => change(field, event.target.value)}
                />
              )}
            </Field>
          ))}
        </div>
      </details>
    </div>
  );
}
