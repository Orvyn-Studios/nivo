[CmdletBinding(SupportsShouldProcess)]
param(
  [Parameter(Mandatory)][ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
  [Parameter(Mandatory)][string]$NivoExecutable,
  [ValidateSet('Chrome','Edge')][string]$Browser = 'Chrome'
)
$ErrorActionPreference = 'Stop'
$resolvedExecutable = (Resolve-Path -LiteralPath $NivoExecutable).Path
if ([IO.Path]::GetExtension($resolvedExecutable) -ne '.exe' -or $resolvedExecutable.StartsWith('\\')) { throw 'Selecciona un ejecutable local de Nivo.' }
$hostDirectory = Join-Path $env:APPDATA 'com.orvyn.nivo\native-host'
$hostManifest = Join-Path $hostDirectory 'com.orvyn.nivo.json'
$vendor = if ($Browser -eq 'Chrome') { 'Google\Chrome' } else { 'Microsoft\Edge' }
$registrationKey = "HKCU:\Software\$vendor\NativeMessagingHosts\com.orvyn.nivo"
if ($PSCmdlet.ShouldProcess($registrationKey, 'Registrar exclusivamente el host local de Nivo para la extensión indicada')) {
  New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
  $origins = @("chrome-extension://$ExtensionId/")
  if (Test-Path -LiteralPath $hostManifest) {
    $existing = Get-Content -Raw -LiteralPath $hostManifest | ConvertFrom-Json
    if ($existing.name -ne 'com.orvyn.nivo') { throw 'El manifiesto existente no pertenece a Nivo.' }
    $origins += @($existing.allowed_origins | Where-Object { $_ -match '^chrome-extension://[a-p]{32}/$' })
  }
  $manifest = @{ name='com.orvyn.nivo'; description='Nivo local downloads'; path=$resolvedExecutable; type='stdio'; allowed_origins=@($origins | Select-Object -Unique) } | ConvertTo-Json
  [IO.File]::WriteAllText($hostManifest, $manifest, [Text.UTF8Encoding]::new($false))
  New-Item -Path $registrationKey -Force | Out-Null
  Set-Item -LiteralPath $registrationKey -Value $hostManifest
}
