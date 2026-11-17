[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9_.-]{1,100}$')][string]$Repository,
    [string]$Notes = 'Обновление Zamer CAD. Локальные проекты сохраняются.',
    [switch]$Publish,
    [switch]$CreateRepository
)
$ErrorActionPreference = 'Stop'
if ($Repository -match '/\.\.?$') { throw 'Invalid repository name' }
if ($CreateRepository -and !$Publish) { throw '-CreateRepository requires -Publish' }
if ($Publish) {
    if (!(Get-Command gh -ErrorAction SilentlyContinue)) { throw 'Install GitHub CLI: https://cli.github.com, then run gh auth login' }
    & gh auth status --hostname github.com
    if ($LASTEXITCODE -ne 0) { throw 'Run gh auth login first. Do not paste a token into this script.' }
}
$projectRoot = Split-Path $PSScriptRoot -Parent
$previousRepository = $env:ZAMER_UPDATE_REPOSITORY
Push-Location $PSScriptRoot
try {
    $env:ZAMER_UPDATE_REPOSITORY = $Repository
    $testClasses = Join-Path $PSScriptRoot 'build/update-policy-tests'
    New-Item -ItemType Directory -Path $testClasses -Force | Out-Null
    & javac -encoding UTF-8 -d $testClasses app/src/main/java/com/zamercad/offline/UpdatePolicy.java tests/UpdatePolicyTest.java
    if ($LASTEXITCODE -ne 0) { throw 'Update policy test compilation failed' }
    & java -cp $testClasses com.zamercad.offline.UpdatePolicyTest
    if ($LASTEXITCODE -ne 0) { throw 'Update policy tests failed' }
    & ./gradlew.bat assembleRelease lintRelease --console=plain
    if ($LASTEXITCODE -ne 0) { throw 'Release build or lint failed' }
    $metadata = Get-Content app/build/outputs/apk/release/output-metadata.json -Raw | ConvertFrom-Json
    $version = [string]$metadata.elements[0].versionName
    $code = [long]$metadata.elements[0].versionCode
    if ($version -notmatch '^\d+\.\d+\.\d+$') { throw 'Use a numeric major.minor.patch versionName' }
    $tag = "v$version"
    $releaseFolder = Join-Path $projectRoot "dist/releases/$version"
    New-Item -ItemType Directory -Path $releaseFolder -Force | Out-Null
    $apkName = "Zamer-CAD-$version-release.apk"
    $apk = Join-Path $releaseFolder $apkName
    Copy-Item -LiteralPath app/build/outputs/apk/release/app-release.apk -Destination $apk -Force
    $sdkLine = Get-Content local.properties | Where-Object { $_ -match '^sdk\.dir=' } | Select-Object -First 1
    if (!$sdkLine) { throw 'Set sdk.dir in android-offline/local.properties' }
    $sdk = $sdkLine.Substring(8).Replace('\:', ':').Replace('\\', '\')
    $buildTools = Join-Path $sdk 'build-tools/35.0.0'
    $verification = & (Join-Path $buildTools 'apksigner.bat') verify --verbose --print-certs $apk
    if ($LASTEXITCODE -ne 0) { throw 'Signature verification failed' }
    if (!($verification -match 'ecafd57f4a6cba70ccde75038fb682aa2aec62d54c6f00cb61b03f814ed3f2b9')) { throw 'The APK is not signed with the original Zamer CAD release key' }
    & (Join-Path $buildTools 'zipalign.exe') -c -P 16 4 $apk
    if ($LASTEXITCODE -ne 0) { throw 'APK alignment failed' }
    $hash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest = [ordered]@{
        packageName = 'com.zamercad.offline'
        versionCode = $code
        versionName = $version
        minSdk = 29
        apkUrl = "https://github.com/$Repository/releases/download/$tag/$apkName"
        sha256 = $hash
        notes = $Notes
    }
    $encoding = [Text.UTF8Encoding]::new($false)
    $manifestFile = Join-Path $releaseFolder 'update.json'
    $notesFile = Join-Path $releaseFolder 'release-notes.md'
    [IO.File]::WriteAllText($manifestFile, ($manifest | ConvertTo-Json), $encoding)
    [IO.File]::WriteAllText($notesFile, $Notes, $encoding)
    [IO.File]::WriteAllText((Join-Path $releaseFolder "$apkName.sha256"), "$hash  $apkName`n", $encoding)
    Write-Output "Prepared: $releaseFolder (versionCode=$code)"
    if (!$Publish) { Write-Output 'Nothing was published. Use -Publish after reviewing the files.'; return }
    if ($CreateRepository) {
        # Release-only repository: no source tree or signing credentials are uploaded.
        & gh repo create $Repository --public --add-readme --description 'Signed offline Zamer CAD Android releases'
        if ($LASTEXITCODE -ne 0) { throw 'Repository creation failed; nothing was published' }
    }
    $visibility = & gh repo view $Repository --json visibility --jq '.visibility'
    if ($LASTEXITCODE -ne 0 -or $visibility.Trim() -ne 'PUBLIC') { throw 'The updater requires a public repository' }
    # Refuse to overwrite an existing release and block equal/lower version codes.
    $existingTags = & gh release list --repo $Repository --limit 100 --json tagName --jq '.[].tagName'
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing releases' }
    if ($existingTags -contains $tag) { throw 'Release tag already exists. Increase versionName and versionCode.' }
    $latest = & gh release view --repo $Repository --json assets 2>$null
    if ($LASTEXITCODE -ne 0 -and $existingTags.Count -gt 0) { throw 'Could not inspect latest release; publication stopped' }
    if ($LASTEXITCODE -eq 0) {
        $latestManifest = ($latest | ConvertFrom-Json).assets | Where-Object name -eq 'update.json' | Select-Object -First 1
        if ($latestManifest) {
            $current = Invoke-RestMethod -Uri $latestManifest.url -MaximumRedirection 5
            if ([long]$current.versionCode -ge $code) { throw 'versionCode must be greater than the current published release' }
        }
    }
    & gh release create $tag $apk $manifestFile (Join-Path $releaseFolder "$apkName.sha256") --repo $Repository --title "Zamer CAD $version" --notes-file $notesFile --draft
    if ($LASTEXITCODE -ne 0) { throw 'Release upload failed; inspect the draft on GitHub before retrying' }
    & gh release edit $tag --repo $Repository --draft=false --latest
    if ($LASTEXITCODE -ne 0) { throw 'Files uploaded as a draft, but publication failed' }
    Write-Output "Published: https://github.com/$Repository/releases/tag/$tag"
} finally {
    if ($null -eq $previousRepository) { Remove-Item Env:ZAMER_UPDATE_REPOSITORY -ErrorAction SilentlyContinue }
    else { $env:ZAMER_UPDATE_REPOSITORY = $previousRepository }
    Pop-Location
}
