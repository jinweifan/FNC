$ErrorActionPreference = "Stop"

$repo = (Resolve-Path "$PSScriptRoot\..").Path
$image = "fncviewer-linux-builder:jammy"

Write-Host "Building Docker image: $image"
docker build -f "$PSScriptRoot\linux-builder-jammy.Dockerfile" -t $image $repo

Write-Host "Running Linux package build in container..."
docker run --rm `
  -v "${repo}:/work" `
  -w /work `
  $image `
  bash -lc "npm ci && npm run package:linux"

Write-Host "Done. Check:"
Write-Host "  src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/appimage"
Write-Host "  src-tauri/target/x86_64-unknown-linux-gnu/release/bundle/deb"
