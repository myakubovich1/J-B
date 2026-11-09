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
docker build -f workers/latex/Dockerfile -t jb-latex:local .
```

Set `LATEX_MODE=docker` and optionally `LATEX_DOCKER_IMAGE`. Image build warms its TeX package cache. Runtime (`sandboxRunArgs` in `src/lib/resume.ts`) uses a non-root UID matching the private temporary-directory owner (65532 when launched by root), an init process, no network, read-only root, all Linux capabilities dropped, no-new-privileges, 384 MB RAM without swap, one CPU, 64 PIDs, 256 open files, an 8 MB per-file write limit, a small `noexec` tmpfs, and a parent deadline (`LATEX_TIMEOUT_MS`, default 45 s, bounded 5–120 s). At the deadline the Docker CLI is killed and the named container force-removed; the file-size limit stops a template from flooding the worker disk with a giant log or PDF. Only the per-compilation private working directory is mounted. No application directory, production secrets, Docker socket, or home folder is mounted into the container. Tectonic's untrusted mode disables shell escape and restricts dangerous features; `--only-cached` prevents runtime dependency retrieval. Unknown packages or fonts fail clearly and must be added to `workers/latex/warmup.tex`, which is compiled at 10/11/12pt during the image build. Math fonts are cached per size, so the warmup exercises every size command; without that, built-in templates failed offline as soon as they printed a `$|$` separator.

Verify the image on each worker host with `RUN_DOCKER_TESTS=1 npx vitest run tests/latex-sandbox.test.ts`. The suite probes the real container (non-root, no capabilities, no routes or DNS, read-only root, `noexec` tmpfs, no Docker socket or host paths, no application secrets, PID/memory/file-size limits) and compiles every built-in template × font family × 10/12pt offline, the documented custom template with an image, and hostile inputs: piped shell input, `\write18`, absolute and `../` writes, output floods, infinite loops (killed at the deadline, container removed), memory exhaustion, corrupt and oversized images, and path-traversal asset names.

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

## User layout settings

Each built-in template has persisted, tenant-scoped layout overrides available from **Layout settings** in Resumes: template/serif/sans font, 10/11/12pt body size, 0.65/0.75/0.90in margins, compact/comfortable spacing, and Letter/A4 paper. Closed Zod choices prevent raw TeX injection through settings. New generated records snapshot the effective settings; earlier PDFs and source remain immutable. **Save & generate** queues real compilation; the resulting PDF is available through the existing preview. Overflow handling still trims content rather than reducing the selected font.

## Custom supporting images

A custom template can have one immutable bundle of up to six flat PNG/JPEG files: 1 MB per file, 3 MB per bundle, and dimensions at most 4096 × 4096. Reference them as `assets/filename.png` in the source. Archives, paths, scripts, SVG, fonts, and arbitrary TeX packages are not supported assets. Upload a new custom template version to replace a bundle.

Private manifests store filenames, sizes, media types, and SHA-256 hashes. Concurrent upload requests atomically claim one manifest; losing or partially failed uploads clean up only their own objects. An uncertain manifest commit preserves objects for recovery. Admission checks limit workspace bundles and bytes, but distributed hard storage accounting still requires a transactional ledger.

The compiler rechecks hashes, validates names/headers/dimensions, writes assets only inside the fresh job directory, and requires Docker for every asset-backed or custom compilation. Header checks do not fully decode an image; decoding occurs within the isolated compiler. Generated resume history retains the exact source/PDF and asset hashes. Docker execution with a supporting image is covered by the sandbox suite.

Custom TeX may contain prose outside the structured placeholders. Every custom-template application requires manual review of its actual generated PDF, even when the user has standing submission authorization.
