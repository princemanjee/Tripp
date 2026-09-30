# Publishes the contents of site/ to the public GitHub Pages repository.
#
# This repository (Tripp) stays private: it holds the specs and the database
# code. Only the static files in site/ are copied to the public repository, as
# a single fresh commit each time, so the public history carries nothing else.
#
# Usage: pwsh scripts/deploy.ps1

param(
	[string]$PublicRepo = 'princemanjee/scratchpad'
)

$ErrorActionPreference = 'Stop'

$site = Join-Path (Split-Path $PSScriptRoot -Parent) 'site'
$config = Get-Content (Join-Path $site 'config.js') -Raw
if ($config -match "url:\s*''" -or $config -match "key:\s*''") {
	throw 'site/config.js has an empty url or key. Fill both in before deploying.'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("pages-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
	Copy-Item (Join-Path $site '*') $work -Recurse -Force
	New-Item -ItemType File -Path (Join-Path $work '.nojekyll') -Force | Out-Null

	git -C $work init --quiet --initial-branch main
	if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
	git -C $work add --all
	if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
	git -C $work commit --quiet -m 'Update'
	if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
	git -C $work push --quiet --force "https://github.com/$PublicRepo.git" main
	if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }

	$owner, $name = $PublicRepo -split '/'
	Write-Output "Published. The site rebuilds in about a minute: https://$owner.github.io/$name/"
}
finally {
	Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
