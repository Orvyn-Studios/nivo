import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

test('Windows measurement parameters and counters reject invalid input without starting Nivo', {
  skip: process.platform !== 'win32' ? 'Windows PowerShell/Win32 check.' : false,
}, async () => {
  // Only isolated parameters, the counter reader and the native tree helper
  // execute. The .ps1 body, sampler and filesystem output never run. ExecutionPolicy
  // stays unchanged; this does not certify that the full .ps1 can run locally.
  const command = String.raw`
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:NIVO_MEASURE_SCRIPT, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
$bind = [ScriptBlock]::Create($ast.ParamBlock.Extent.Text + [Environment]::NewLine + "'bound'")
if ((& $bind -NivoProcessId 1 -DurationSeconds 1 -IntervalSeconds 60 -OutputDirectory unused) -ne 'bound') { throw 'Valid boundary parameters failed.' }
$invalid = @(
    @{ NivoProcessId = 0 },
    @{ NivoProcessId = 1; DurationSeconds = 0 },
    @{ NivoProcessId = 1; DurationSeconds = 86401 },
    @{ NivoProcessId = 1; IntervalSeconds = 0 },
    @{ NivoProcessId = 1; IntervalSeconds = 61 },
    @{ NivoProcessId = 1; ExpectedProcessName = 'chrome' },
    @{ NivoProcessId = 1; PowerSource = 'invented' }
)
foreach ($arguments in $invalid) {
    $rejected = $false
    try { & $bind @arguments -OutputDirectory unused | Out-Null }
    catch { if ($_.FullyQualifiedErrorId -notmatch 'ParameterArgumentValidationError') { throw }; $rejected = $true }
    if (-not $rejected) { throw 'An invalid parameter set was accepted.' }
}
$reader = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-NivoProcess' }, $true)
if ($null -eq $reader) { throw 'Counter reader missing.' }
. ([ScriptBlock]::Create($reader.Extent.Text))
$snapshot = Read-NivoProcess $PID
if ($null -eq $snapshot -or $snapshot.Id -ne $PID -or $snapshot.WorkingSetBytes -le 0 -or $snapshot.PrivateBytes -le 0 -or $snapshot.CpuSeconds -lt 0 -or $snapshot.StartTicks -le 0) { throw 'Current process counters invalid.' }
if ($null -ne (Read-NivoProcess 2147483647)) { throw 'Missing process was replaced by invented counters.' }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Add-Type' }, $true)
$source = $definition.CommandElements | Where-Object { $_ -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $_.Value.StartsWith('using System;') }
if ($null -eq $source) { throw 'Win32 helper missing.' }
Add-Type -TypeDefinition $source.Value
$entries = [Orvyn.Nivo.Quality.ProcessTree]::Read()
if (-not ($entries | Where-Object { $_.Id -eq $PID })) { throw 'Native process tree does not contain the current process.' }
'PASS: isolated parameter validation, real counters and Win32 tree; sampler/app not started.'
`;
  const result = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    timeout: 20000, windowsHide: true, maxBuffer: 256 * 1024,
    env: { ...process.env, NIVO_MEASURE_SCRIPT: fileURLToPath(new URL('../scripts/measure-process.ps1', import.meta.url)) },
  });
  assert.match(result.stdout, /PASS: isolated parameter validation, real counters and Win32 tree/);
  assert.equal(result.stderr, '');
});
