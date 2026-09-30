# Publishes the contents of site/ to GitHub Pages.
#
# The static files in site/ are pushed to the gh-pages branch of this
# repository as a single fresh commit each time. GitHub Pages serves that
# branch, so the portal lives at https://<owner>.github.io/<repo>/ and the
# published branch carries the page files and nothing else.
#
# Usage: pwsh scripts/deploy.ps1
#        pwsh scripts/deploy.ps1 -AllowEmptyConfig   (publish before the key is filled in)

param(
	[string]$Repo = 'princemanjee/Tripp',
	[string]$Branch = 'gh-pages',
	[switch]$AllowEmptyConfig
)

$ErrorActionPreference = 'Stop'

$site = Join-Path (Split-Path $PSScriptRoot -Parent) 'site'
$config = Get-Content (Join-Path $site 'config.js') -Raw
if (-not $AllowEmptyConfig -and ($config -match "url:\s*''" -or $config -match "key:\s*''")) {
	throw 'site/config.js has an empty url or key. Fill both in before deploying.'
}

$work = Join-Path ([System.IO.Path]::GetTempPath()) ("pages-" + [System.Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $work | Out-Null
try {
	Copy-Item (Join-Path $site '*') $work -Recurse -Force
	New-Item -ItemType File -Path (Join-Path $work '.nojekyll') -Force | Out-Null

	git -C $work init --quiet --initial-branch $Branch
	if ($LASTEXITCODE -ne 0) { throw 'git init failed.' }
	git -C $work add --all
	if ($LASTEXITCODE -ne 0) { throw 'git add failed.' }
	git -C $work commit --quiet -m 'Update'
	if ($LASTEXITCODE -ne 0) { throw 'git commit failed.' }
	git -C $work push --quiet --force "https://github.com/$Repo.git" "${Branch}:${Branch}"
	if ($LASTEXITCODE -ne 0) { throw 'git push failed.' }

	$owner, $name = $Repo -split '/'
	Write-Output "Published. The site rebuilds in about a minute: https://$owner.github.io/$name/"
}
finally {
	Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}
