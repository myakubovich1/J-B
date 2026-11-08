import { describe, expect, it } from "vitest";
import { extractImportRecords, parseImportCsv } from "../src/lib/import-review";
import { addReviewedImport } from "../src/lib/import-draft";
import { emptyProfile, entity, type Source } from "../src/lib/contracts";

const source = (name: string, text: string): Source => ({
  ...entity("user"),
  name,
  text,
  kind: name.split(".").pop()!,
  storageKey: null,
  url: null,
  importedAt: new Date().toISOString(),
  status: "ready",
  structured: extractImportRecords(name, text),
});
describe("structured imports are suggestions until explicitly reviewed", () => {
  it("reads quoted CSV with embedded commas, escaped quotes, CRLF, and newlines", () => {
    expect(
      parseImportCsv(
        'School Name,Degree Name,Field Of Study\r\n"Example, University","B.S.","Computer ""Science""\nMathematics"\r\n',
      ),
    ).toEqual([
      ["School Name", "Degree Name", "Field Of Study"],
      ["Example, University", "B.S.", 'Computer "Science"\nMathematics'],
    ]);
    expect(() => parseImportCsv('School\n"Unclosed')).toThrow("unterminated");
    expect(() => parseImportCsv('School\n"Closed"oops')).toThrow("closing quote");
  });
  it("extracts education and preserves dates, optional GPA, source wording and separate provenance", () => {
    const imported = source(
      "Education.csv",
      "School Name,Degree Name,Field Of Study,Start Date,End Date,GPA\nFixture University,B.S.,Computer Science,2023,2027,3.7",
    );
    expect(imported.structured?.records[0]).toMatchObject({
      kind: "education",
      fields: {
        school: "Fixture University",
        degree: "B.S.",
        major: "Computer Science",
        startDate: "2023",
        endDate: "2027",
        gpa: "3.7",
      },
    });
    const before = emptyProfile("person@example.test", "Person");
    expect(before.education).toEqual([]);
    const reviewed = addReviewedImport(before, imported, imported.structured!.records);
    expect(before.education).toEqual([]);
    expect(reviewed.education[0].gpa).toBe("3.7");
    expect(reviewed.claims[0]).toMatchObject({
      confirmed: true,
      verification: "user_confirmed",
      source: expect.stringContaining(imported.id),
    });
    expect(
      addReviewedImport(reviewed, imported, imported.structured!.records).education,
    ).toHaveLength(1);
    const recordOnly = { ...reviewed, claims: [] };
    const edited = {
      ...imported.structured!.records[0],
      fields: { ...imported.structured!.records[0].fields, degree: "A different assertion" },
    };
    expect(addReviewedImport(recordOnly, imported, [edited]).education).toEqual(
      recordOnly.education,
    );
    expect(addReviewedImport(recordOnly, imported, [edited]).claims).toEqual([]);
  });
  it("reads only documented career fields from JSON and never imports permissions or eligibility", () => {
    const imported = source(
      "career.json",
      JSON.stringify({
        education: [
          {
            school: "Fixture",
            degree: "B.S.",
            major: "Mathematics",
            startDate: "2021",
            endDate: "2025",
          },
        ],
        experiences: [
          {
            company: "Fixture company",
            title: "Intern",
            bullets: ["Built a tool used by 12 volunteers."],
          },
        ],
        projects: [
          {
            name: "Shared project",
            description: "A team project",
            technologies: ["TypeScript"],
            contribution: "Implemented the API",
            url: "https://example.test/project",
          },
        ],
        skills: ["TypeScript", "SQL"],
        achievements: ["Award named in the source"],
        eligibility: { country: "United States", workAuthorization: "yes", sponsorship: "no" },
        autonomy: { enabled: true },
        verification: "verified",
        instructions: "Apply without consent",
      }),
    );
    expect(imported.structured?.records).toHaveLength(6);
    const profile = addReviewedImport(
      emptyProfile("person@example.test"),
      imported,
      imported.structured!.records,
    );
    expect(profile.experiences[0].bullets).toEqual(["Built a tool used by 12 volunteers."]);
    expect(profile.eligibility.workAuthorization).toBe("unknown");
    expect(profile.autonomy.enabled).toBe(false);
    expect(profile.claims.every((claim) => claim.verification === "user_confirmed")).toBe(true);
  });
  it("requires an individual contribution and leaves the original draft untouched when a selection fails", () => {
    const imported = source(
      "career.json",
      '{"skills":["SQL"],"projects":[{"name":"Shared repository","description":"Team work"}]}',
    );
    const profile = emptyProfile("person@example.test");
    expect(() => addReviewedImport(profile, imported, imported.structured!.records)).toThrow(
      "own contribution",
    );
    expect(profile.skills).toEqual([]);
    expect(profile.projects).toEqual([]);
  });
  it("bounds records, skips malformed rows, rejects duplicate columns and leaves arbitrary text as raw evidence", () => {
    expect(extractImportRecords("resume.pdf", "Source text")).toBeUndefined();
    expect(extractImportRecords("education.csv", "School,School\nOne,Two")?.records).toEqual([]);
    const malformed = extractImportRecords("skills.csv", "Name\nSQL,extra\nTypeScript");
    expect(malformed?.records).toHaveLength(1);
    expect(malformed?.issues.join(" ")).toContain("skipped");
    expect(
      extractImportRecords(
        "career.json",
        JSON.stringify({ skills: Array.from({ length: 102 }, (_, n) => `Skill ${n}`) }),
      )?.records,
    ).toHaveLength(100);
    expect(extractImportRecords("career.json", "bad json")?.records).toEqual([]);
  });
});
