# Reviewable career imports

Document uploads are private, bounded, and processed by the worker. PDF, TXT, Markdown, JSON, CSV, and TeX text can be reviewed in Career Profile → Saved sources. Text-based PDFs require Poppler; OCR is not enabled. Uploaded instructions are treated as document text and cannot authorize actions.

CSV and JSON sources also produce editable profile suggestions. No suggestion is inserted into the canonical profile automatically. Select records, inspect their fields, edit mistakes, and explicitly confirm the selection. **Add reviewed records to profile draft** updates only the local editor draft; **Save profile** persists it. Each accepted record keeps a source reference and is labeled user-confirmed, never externally verified. Reopening the same record does not duplicate it. A project needs an explicit statement of the user's own contribution.

The parser does not import legal eligibility, sponsorship, autonomy settings, credentials, payment data, or verification flags. These require their own product controls. It does not infer degrees, dates, skill mastery, sole authorship, GPA, or achievements from neighboring text.

## CSV columns

Column names are matched without case sensitivity; underscores and hyphens normalize to spaces. Quoted commas, doubled quotes, and embedded newlines are supported. A malformed row is skipped with a visible notice; duplicate headings or malformed quoting produce an extraction notice. At most 100 distinct suggestions are shown.

| Record | Identifying columns | Other supported columns |
| --- | --- | --- |
| Education | `School Name`, `School`, `University`, or `Institution` | `Degree Name`/`Degree`, `Field Of Study`/`Major`, `Start Date`, `End Date`, `GPA`, `Coursework` |
| Experience | `Company Name`, `Company`, or `Employer` | `Title`/`Position`, `Location`, `Start Date`, `End Date`, `Bullets`/`Description` |
| Project | `Project Name`, or `Type=project` and `Name` | `Description`, `Technologies`, `URL`, `Contribution` |
| Skill | `Skill`, or `Type=skill` and `Name` | A file named `Skills.csv` may use a `Name` column |
| Achievement | `Achievement`, or `Type=achievement` and `Text` | `Description` can supply the text |

Some user-provided exports use these columns. Export formats vary; unsupported data remains readable as source text and can be entered manually. The parser does not claim universal LinkedIn or university transcript compatibility.

```csv
School Name,Degree Name,Field Of Study,Start Date,End Date,GPA
Example University,B.S.,Computer Science,2023,2027,3.7
```

## JSON structure

Use a top-level object with any of these arrays. Unknown keys are ignored. The following is illustrative data, not a seeded customer profile:

```json
{
  "education": [{ "school": "Example University", "degree": "B.S.", "major": "Computer Science", "startDate": "2023", "endDate": "2027" }],
  "experiences": [{ "company": "Example organization", "title": "Volunteer", "location": "", "startDate": "2024", "endDate": "2025", "bullets": ["A statement to review and confirm."] }],
  "projects": [{ "name": "Shared project", "description": "A description from the source", "technologies": ["TypeScript"], "url": "https://example.com/project", "contribution": "The part I personally implemented" }],
  "skills": ["TypeScript"],
  "achievements": ["An accomplishment to review"]
}
```

Dates and numbers retain their source wording. CSV formulas and embedded instructions are never executed. Automatic extraction from arbitrary resume/transcript prose and OCR remain future work; the raw-text evidence workflow is available for these documents.
