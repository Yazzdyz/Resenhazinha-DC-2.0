$ErrorActionPreference = "Stop"

$RepoUrl = "https://github.com/Yazzdyz/Resenhazinha-DC-2.0.git"
$Tag = "v2.13.1"

Write-Host "Configurando Resenhazinha no GitHub..." -ForegroundColor Cyan

# Confere se o Git existe
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Host "Git nao foi encontrado no PC." -ForegroundColor Red
    exit 1
}

# Inicializa apenas se ainda nao for um repositorio Git
& git rev-parse --is-inside-work-tree *> $null
if ($LASTEXITCODE -ne 0) {
    & git init
    if ($LASTEXITCODE -ne 0) { throw "Falha ao executar git init." }
}

# Garante a branch main
& git branch -M main
if ($LASTEXITCODE -ne 0) { throw "Falha ao definir a branch main." }

# IMPORTANTE: primeiro lista os remotes. 'git remote' nao falha quando nao existe origin.
$remotes = @(& git remote)
if ($LASTEXITCODE -ne 0) { throw "Falha ao listar remotes do Git." }

if ($remotes -contains "origin") {
    $originUrl = (& git remote get-url origin).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Falha ao ler o remote origin existente." }

    if ($originUrl -ne $RepoUrl) {
        Write-Host "Atualizando remote origin..." -ForegroundColor Yellow
        & git remote set-url origin $RepoUrl
        if ($LASTEXITCODE -ne 0) { throw "Falha ao atualizar o remote origin." }
    }
} else {
    Write-Host "Criando remote origin..." -ForegroundColor Yellow
    & git remote add origin $RepoUrl
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o remote origin." }
}

# Configuracao de identidade para commits
$userName = (& git config user.name).Trim()
$userEmail = (& git config user.email).Trim()

if (-not $userName) {
    $userName = Read-Host "Qual nome deseja usar nos commits? (ex: Yazzdyz)"
    & git config user.name $userName
}

if (-not $userEmail) {
    $userEmail = Read-Host "Qual email deseja usar nos commits?"
    & git config user.email $userEmail
}

Write-Host "Adicionando arquivos..." -ForegroundColor Cyan
& git add .
if ($LASTEXITCODE -ne 0) { throw "Falha no git add." }

# Faz commit somente se houver algo para commitar
& git diff --cached --quiet
$hasChanges = ($LASTEXITCODE -ne 0)

if ($hasChanges) {
    & git commit -m "Resenhazinha v2.13.1 - GitHub e auto update"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o commit." }
} else {
    Write-Host "Nenhuma alteracao nova para commit." -ForegroundColor DarkGray
}

Write-Host "Enviando branch main..." -ForegroundColor Cyan
& git push -u origin main
if ($LASTEXITCODE -ne 0) {
    Write-Host "Nao consegui fazer push da main. Veja a mensagem acima (pode ser login/permissao do GitHub)." -ForegroundColor Red
    exit 1
}

# Cria a tag apenas se ainda nao existir localmente
$localTags = @(& git tag --list $Tag)
if (-not ($localTags -contains $Tag)) {
    & git tag -a $Tag -m "Resenhazinha $Tag"
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar a tag $Tag." }
}

Write-Host "Enviando tag $Tag..." -ForegroundColor Cyan
& git push origin $Tag
if ($LASTEXITCODE -ne 0) {
    Write-Host "A main foi enviada, mas houve erro ao enviar a tag." -ForegroundColor Red
    exit 1
}

Write-Host "" 
Write-Host "PRONTO!" -ForegroundColor Green
Write-Host "Repositorio: $RepoUrl"
Write-Host "Branch: main"
Write-Host "Tag enviada: $Tag"
Write-Host "Agora o GitHub Actions deve iniciar a montagem do Release." -ForegroundColor Green
