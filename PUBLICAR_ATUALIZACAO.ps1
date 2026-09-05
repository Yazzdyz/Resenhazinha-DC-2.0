$ErrorActionPreference = "Stop"

$version = (Get-Content .\package.json -Raw | ConvertFrom-Json).version
$tag = "v$version"

Write-Host "Publicando $tag..." -ForegroundColor Cyan

git add .
$changes = git status --porcelain
if ($changes) {
  git commit -m "Resenhazinha $tag"
}

git push origin main

$existing = git tag --list $tag
if ($existing) {
  throw "A tag $tag ja existe. Aumente a versao no package.json antes de publicar uma nova atualizacao."
}

git tag $tag
git push origin $tag

Write-Host "Tag enviada. O GitHub Actions vai criar o Release automaticamente." -ForegroundColor Green
