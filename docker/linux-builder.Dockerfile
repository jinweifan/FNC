FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get -o Acquire::Retries=5 update && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    xz-utils \
    file \
    || (apt-get update && apt-get install -y --fix-missing --no-install-recommends \
    curl \
    ca-certificates \
    build-essential \
    pkg-config \
    libwebkit2gtk-4.1-dev \
    libgtk-3-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    patchelf \
    xz-utils \
    file) \
    && rm -rf /var/lib/apt/lists/*

RUN curl https://sh.rustup.rs -sSf | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"

WORKDIR /work

CMD ["bash", "-lc", "npm ci && npm run tauri -- build --target x86_64-unknown-linux-gnu --bundles appimage,deb"]
