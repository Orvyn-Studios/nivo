param([Parameter(Mandatory)][int]$NivoId,[Parameter(Mandatory)][string]$ExpectedPath)
$ErrorActionPreference='Stop'
$owned=Get-Process -Id $NivoId -ErrorAction Stop
if(-not [StringComparer]::OrdinalIgnoreCase.Equals($owned.Path,[IO.Path]::GetFullPath($ExpectedPath))){throw 'Process does not match the explicitly launched Nivo executable.'}
if(-not $owned.CloseMainWindow()){throw 'Owned Nivo window did not accept normal close.'}
if(-not $owned.WaitForExit(4000)){throw 'Owned Nivo did not exit within four seconds.'}
@{closed=$true;processId=$NivoId} | ConvertTo-Json -Compress
