FROM debian:bookworm-slim AS fetch
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl && rm -rf /var/lib/apt/lists/*
ARG TECTONIC_VERSION=0.17.0
ARG TARGETARCH
RUN arch="x86_64"; if [ "$TARGETARCH" = "arm64" ]; then arch="aarch64"; fi; \
    curl -fSL "https://github.com/tectonic-typesetting/tectonic/releases/download/tectonic%40${TECTONIC_VERSION}/tectonic-${TECTONIC_VERSION}-${arch}-unknown-linux-musl.tar.gz" | tar -xz -C /usr/local/bin tectonic

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates fontconfig libfontconfig1 libfreetype6 fonts-lmodern && rm -rf /var/lib/apt/lists/*
COPY --from=fetch /usr/local/bin/tectonic /usr/local/bin/tectonic
ENV XDG_CACHE_HOME=/opt/tectonic-cache HOME=/tmp TECTONIC_UNTRUSTED_MODE=1
# Warm the package cache during image build; execution itself has no network.
COPY workers/latex/warmup.tex /tmp/warmup.tex
RUN tectonic -X compile --untrusted --keep-logs --outdir /tmp /tmp/warmup.tex && chmod -R a+rX /opt/tectonic-cache && rm -f /tmp/warmup.*
USER 65532:65532
WORKDIR /work
ENTRYPOINT ["tectonic", "-X", "compile", "--untrusted", "--only-cached", "--keep-logs", "--outdir", "/work"]
