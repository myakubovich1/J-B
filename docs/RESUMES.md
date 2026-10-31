# Structured LaTeX resumes

The renderer separates candidate facts from TeX. It selects confirmed experience and projects, education entered in the profile, manually entered skills, and confirmed skill claims. Imported projects and AI suggestions do not enter resumes until confirmed. Job terms only rank existing records and reorder exact original bullets: they cannot create accomplishments, change numbers, or infer sole authorship.

Six built-in layouts are provided. Jake's Resume is an adaptation of [Jake Gutierrez's MIT-licensed template](https://github.com/jakegut/resume); upstream attribution and its complete license are retained in `templates/`. The other five layouts are original variations. A template assigned to a career track takes precedence over the default when the application worker selects it.

## Local compilation

Use Node 24+, install [Tectonic](https://tectonic-typesetting.github.io/) and Poppler (`brew install tectonic poppler` on macOS). `TECTONIC_BIN` can select the compiler executable. The first trusted local compile downloads the TeX package bundle. Local host compilation accepts only the application's generated built-in template sources and escaped candidate data.

Run actual compiler integration checks with:

```sh
RUN_LATEX_TESTS=1 npm test -- tests/resume.test.ts
```

## Isolated compilation

Every production compile and every custom-template compile requires Docker. Build the compiler image on the dedicated worker host:

```sh
docker build -f workers/latex/Dockerfile -t career-latex:local .
```

Set `LATEX_MODE=docker` and optionally `LATEX_DOCKER_IMAGE`. Image build warms its TeX package cache. Runtime uses a non-root UID matching the private temporary-directory owner (65532 when launched by root), no network, read-only root, all Linux capabilities dropped, no-new-privileges, 384 MB RAM, one CPU, 64 PIDs, a small tmpfs, and a 45-second parent deadline. Cleanup explicitly removes the named container after timeouts. Only the per-compilation private working directory is mounted. No application directory, production secrets, Docker socket, or home folder is mounted into the container. Tectonic's untrusted mode disables shell escape and restricts dangerous features; `--only-cached` prevents runtime dependency retrieval. Unknown packages fail clearly and must be reviewed and added during image build.

The worker host may have Docker access, but the compiler container never receives the host's Docker socket. Use a dedicated worker host; never run prolonged compilation in the Next.js serverless request. The job worker calls the resume engine asynchronously. Application deployment images must include Poppler for PDF validation and document parsing.

## Custom template contract

Upload a self-contained `.tex` file of at most 64 KiB. No supporting scripts, arbitrary includes, remote assets, or custom package installation are supported. Start with `templates/custom-example.tex`.

Placeholders are replaced once with escaped data or renderer-controlled section markup:

| Placeholder       | Content                                                    |
| ----------------- | ---------------------------------------------------------- |
| `{{NAME}}`        | Escaped legal name; required                               |
| `{{CONTACT}}`     | Escaped email, phone, location, and public links; required |
| `{{SUMMARY}}`     | User-provided headline                                     |
| `{{EDUCATION}}`   | Education section                                          |
| `{{EXPERIENCE}}`  | Confirmed experience section                               |
| `{{PROJECTS}}`    | Confirmed projects section                                 |
| `{{SKILLS}}`      | Confirmed skills section                                   |
| `{{RESUME_BODY}}` | All sections above in standard order                       |

Include `{{RESUME_BODY}}` or all four section placeholders. Unknown placeholders and common file I/O/shell primitives are rejected before compilation. This validation is defense in depth; Docker is the trust boundary because TeX can obscure commands.

## Validation and limits

The engine checks compilation success, PDF signature and size, extractable text, candidate name and email, page count, TeX overflow/missing-glyph diagnostics, and Poppler word bounding boxes for clipping or substantial text overlays. Unicode OpenType font mapping preserves accented names. The default page limit is one; set `RESUME_MAX_PAGES=2` or `3` for experienced candidates. When a resume overflows, the engine removes lowest-ranked projects/bullets, excess skills, and optional summary, then recompiles. Body font size stays at 11pt.

PDFs with unresolved overflow, missing glyphs, failed identity checks, or excessive page counts are stored with `validation.valid=false` and cannot proceed to an application upload. The exact structured content, TeX source, PDF, source record IDs, warnings, and errors remain inspectable. Automated checks cannot prove every possible visual overlap in arbitrary custom templates; visually review custom layouts before relying on them. No claim of complete visual validation is made.

Uploaded PDF imports are bounded to 10 MB and 30 pages with subprocess deadlines. Text imports include TXT, Markdown, JSON, CSV (including LinkedIn export files), and TeX. Scanned PDFs require user-provided text; OCR is not configured. Extraction produces untrusted source text for review, not confirmed profile facts.
