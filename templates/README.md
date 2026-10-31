# Resume template registry

Built-in templates use the structured renderer in `src/lib/resume.ts`; they never contain candidate sample data. Jake's Resume adapts the section hierarchy and single-column typography of [Jake Gutierrez's MIT template](https://github.com/jakegut/resume). The upstream source is retained for attribution/reference as `jakes-original.tex`; it is not a runtime template and none of its sample content enters a generated resume. Preserve `LICENSE-JAKES` when redistributing.

The other five layouts are original MIT-licensed layouts. All layouts use 11pt body type, ordinary text and headings, no graphical skill ratings, and a single reading order.

Custom template authors should start from `custom-example.tex`. See `docs/RESUMES.md` for the placeholder and security contract.
