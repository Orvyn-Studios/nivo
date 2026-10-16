# Measures only an explicitly selected Nivo process and its observed descendants.
# No CIM, command lines, windows, screen contents, network calls or app control.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateRange(1, 2147483647)]
    [int]$NivoProcessId,

    [ValidateSet('nivo-desktop', 'nivo')]
    [string]$ExpectedProcessName = 'nivo-desktop',

    [ValidateRange(1, 86400)]
    [int]$DurationSeconds = 1800,

    [ValidateRange(1, 60)]
    [int]$IntervalSeconds = 5,

    [ValidateLength(1, 160)]
    [string]$Condition = 'idle-visible',

    [ValidateLength(0, 160)]
    [string]$BuildLabel = 'unspecified',

    [ValidateLength(0, 240)]
    [string]$HardwareDescription = 'not supplied',

    [ValidateLength(0, 240)]
    [string]$DisplayConfiguration = 'not supplied',

    [ValidateSet('AC', 'Battery', 'Unknown')]
    [string]$PowerSource = 'Unknown',

    [string]$OutputDirectory = (Join-Path $PSScriptRoot '..\artifacts\performance')
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($env:OS -ne 'Windows_NT') { throw 'PLATFORM_UNSUPPORTED: esta medicion requiere Windows.' }

try { $rootProcess = Get-Process -Id $NivoProcessId -ErrorAction Stop }
catch { throw "NIVO_PROCESS_UNAVAILABLE: no se puede consultar el PID $NivoProcessId. $($_.Exception.Message)" }

if ($rootProcess.ProcessName -ine $ExpectedProcessName) {
    throw "PROCESS_NAME_MISMATCH: el PID $NivoProcessId es '$($rootProcess.ProcessName)', se esperaba '$ExpectedProcessName'. No se ha iniciado una medicion."
}
try { $rootStartTicks = $rootProcess.StartTime.ToUniversalTime().Ticks }
catch { throw "PROCESS_ACCESS_DENIED: no se puede leer la identidad del PID $NivoProcessId. $($_.Exception.Message)" }

# Toolhelp returns process IDs, parent IDs and executable basenames only.
if (-not ('Orvyn.Nivo.Quality.ProcessTree' -as [type])) {
    try {
        Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;

namespace Orvyn.Nivo.Quality {
    public sealed class ProcessEntry {
        public int Id;
        public int ParentId;
    }
    public static class ProcessTree {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct PROCESSENTRY32 {
            public uint dwSize;
            public uint cntUsage;
            public uint th32ProcessID;
            public IntPtr th32DefaultHeapID;
            public uint th32ModuleID;
            public uint cntThreads;
            public uint th32ParentProcessID;
            public int pcPriClassBase;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string szExeFile;
        }
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool Process32FirstW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern bool Process32NextW(IntPtr snapshot, ref PROCESSENTRY32 entry);
        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool CloseHandle(IntPtr handle);

        public static ProcessEntry[] Read() {
            IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
            if (snapshot == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
            try {
                var entry = new PROCESSENTRY32();
                entry.dwSize = (uint)Marshal.SizeOf(typeof(PROCESSENTRY32));
                var entries = new List<ProcessEntry>();
                if (!Process32FirstW(snapshot, ref entry)) {
                    int error = Marshal.GetLastWin32Error();
                    if (error != 18) throw new Win32Exception(error);
                    return entries.ToArray();
                }
                do {
                    entries.Add(new ProcessEntry { Id = checked((int)entry.th32ProcessID), ParentId = checked((int)entry.th32ParentProcessID) });
                } while (Process32NextW(snapshot, ref entry));
                int lastError = Marshal.GetLastWin32Error();
                if (lastError != 18) throw new Win32Exception(lastError);
                return entries.ToArray();
            } finally { CloseHandle(snapshot); }
        }
    }
}
'@
    } catch { throw "PROCESS_TREE_UNAVAILABLE: no se pudo cargar la lectura Win32 del arbol de procesos. $($_.Exception.Message)" }
}

function Read-NivoProcess([int]$ProcessId) {
    try { $process = Get-Process -Id $ProcessId -ErrorAction Stop }
    catch {
        # A process disappearing between the Toolhelp snapshot and this read is
        # normal. Access errors are never replaced with invented zero counters.
        if ($_.CategoryInfo.Category -eq 'ObjectNotFound') { return $null }
        throw "PROCESS_ACCESS_DENIED: Get-Process no pudo consultar el PID $ProcessId. $($_.Exception.Message)"
    }
    try {
        $process.Refresh()
        $identityTicks = $process.StartTime.ToUniversalTime().Ticks
        $cpuSeconds = $process.TotalProcessorTime.TotalSeconds
        $workingSet = $process.WorkingSet64
        $privateBytes = $process.PrivateMemorySize64
        if ($workingSet -lt 0 -or $privateBytes -lt 0 -or $cpuSeconds -lt 0) { throw 'Contadores negativos.' }
        return [pscustomobject]@{
            Id = $ProcessId
            Name = $process.ProcessName
            StartTicks = $identityTicks
            CpuSeconds = [double]$cpuSeconds
            WorkingSetBytes = [long]$workingSet
            PrivateBytes = [long]$privateBytes
        }
    } catch {
        if ($process.HasExited) { return $null }
        throw "PROCESS_COUNTERS_UNAVAILABLE: no se pudieron leer los contadores del PID $ProcessId. $($_.Exception.Message)"
    } finally { $process.Dispose() }
}

$logicalProcessors = [Environment]::ProcessorCount
if ($logicalProcessors -lt 1) { throw 'CPU_TOPOLOGY_UNAVAILABLE: no se pudo obtener un denominador valido de procesadores logicos.' }
$outputPath = [IO.Path]::GetFullPath($OutputDirectory)
[IO.Directory]::CreateDirectory($outputPath) | Out-Null
$measurementId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
$csvPath = Join-Path $outputPath "$measurementId.csv"
$metadataPath = Join-Path $outputPath "$measurementId.json"
$startedUtc = [DateTime]::UtcNow
$clock = [Diagnostics.Stopwatch]::StartNew()
$known = @{}
$previous = @{}
$previousUtc = $startedUtc
$previousElapsed = 0.0
$sampleCount = 0
$incompleteCpuSamples = 0
$observed = @{}
$failure = $null
$status = 'running'
$metadata = [ordered]@{
    schemaVersion = 1
    measurementId = $measurementId
    startedUtc = $startedUtc.ToString('o')
    requestedDurationSeconds = $DurationSeconds
    requestedIntervalSeconds = $IntervalSeconds
    rootProcessId = $NivoProcessId
    rootStartTimeUtc = [DateTime]::new($rootStartTicks, [DateTimeKind]::Utc).ToString('o')
    expectedProcessName = $ExpectedProcessName
    buildLabel = $BuildLabel
    condition = $Condition
    hardwareDescription = $HardwareDescription
    displayConfiguration = $DisplayConfiguration
    powerSource = $PowerSource
    operatingSystem = [Environment]::OSVersion.VersionString
    logicalProcessorsForNormalization = $logicalProcessors
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    cpuDefinition = '100 * sum(process CPU seconds delta) / elapsed wall seconds / Environment.ProcessorCount; CPU is blank for incomplete intervals.'
    workingSetDefinition = 'Sum of current resident working sets, including shared pages counted per process; not unique physical RAM.'
    privateBytesDefinition = 'Sum of private committed bytes (PrivateMemorySize64); not private resident RAM and not added to working set.'
    scope = 'Exact root process identity and observed descendants, including WebView2. A child that starts and exits between samples is not observable.'
    limitations = 'Sampling adds overhead. Run against a release build without development tools for acceptance. External shared processes and GPU memory are not attributed. No FPS measurement.'
    csv = [IO.Path]::GetFileName($csvPath)
}

try {
    while ($true) {
        $sampleUtc = [DateTime]::UtcNow
        try { $tree = [Orvyn.Nivo.Quality.ProcessTree]::Read() }
        catch { throw "PROCESS_TREE_UNAVAILABLE: Toolhelp no pudo enumerar procesos. $($_.Exception.Message)" }

        $current = @{}
        $root = Read-NivoProcess $NivoProcessId
        if ($null -eq $root -or $root.StartTicks -ne $rootStartTicks) { $status = 'root-exited'; break }
        $current[$NivoProcessId] = $root

        # Retain live descendants if WebView2 outlives its original parent;
        # PID reuse cannot adopt a different process because start times match.
        foreach ($knownId in @($known.Keys)) {
            if ($knownId -eq $NivoProcessId) { continue }
            $member = Read-NivoProcess $knownId
            if ($null -ne $member -and $member.StartTicks -eq $known[$knownId]) { $current[$knownId] = $member }
        }
        $changed = $true
        while ($changed) {
            $changed = $false
            foreach ($entry in $tree) {
                if ($current.ContainsKey($entry.Id) -or -not $current.ContainsKey($entry.ParentId)) { continue }
                $member = Read-NivoProcess $entry.Id
                if ($null -eq $member) { continue }
                # Windows can reuse a former parent PID. A real child cannot
                # predate the current identity of its parent.
                if ($member.StartTicks -lt $current[$entry.ParentId].StartTicks) { continue }
                $current[$entry.Id] = $member
                $changed = $true
            }
        }

        $sampleElapsed = $clock.Elapsed.TotalSeconds
        $interval = $sampleElapsed - $previousElapsed
        $workingSetSum = 0L
        $privateSum = 0L
        $cpuDelta = 0.0
        $reasons = [Collections.Generic.List[string]]::new()
        foreach ($member in $current.Values) {
            $workingSetSum += $member.WorkingSetBytes
            $privateSum += $member.PrivateBytes
            $known[$member.Id] = $member.StartTicks
            $observed["$($member.Id):$($member.StartTicks)"] = [ordered]@{ id = $member.Id; name = $member.Name }
            if ($previous.ContainsKey($member.Id) -and $previous[$member.Id].StartTicks -eq $member.StartTicks) {
                $delta = $member.CpuSeconds - $previous[$member.Id].CpuSeconds
                if ($delta -lt 0) { $reasons.Add('cpu-counter-regressed') } else { $cpuDelta += $delta }
            } elseif ($sampleCount -gt 0) {
                if ($member.StartTicks -ge $previousUtc.Ticks) { $cpuDelta += $member.CpuSeconds }
                else { $reasons.Add('process-discovered-without-baseline') }
            }
        }
        foreach ($previousId in $previous.Keys) {
            if (-not $current.ContainsKey($previousId) -or $current[$previousId].StartTicks -ne $previous[$previousId].StartTicks) {
                $reasons.Add('process-exited-before-final-counter')
                $known.Remove($previousId)
            }
        }
        $cpuPercent = $null
        $cpuStatus = 'baseline'
        if ($sampleCount -gt 0) {
            if ($reasons.Count -eq 0 -and $interval -gt 0) {
                $cpuPercent = [Math]::Round(100.0 * $cpuDelta / $interval / $logicalProcessors, 4)
                $cpuStatus = 'complete-observed-tree'
            } else { $cpuStatus = 'incomplete'; $incompleteCpuSamples++ }
        }
        $row = [pscustomobject][ordered]@{
            timestamp_utc = $sampleUtc.ToString('o')
            elapsed_seconds = [Math]::Round($sampleElapsed, 4)
            interval_seconds = [Math]::Round($interval, 4)
            process_count = $current.Count
            cpu_percent_normalized = $cpuPercent
            cpu_status = $cpuStatus
            working_set_bytes_sum = $workingSetSum
            private_bytes_sum = $privateSum
            incomplete_reason = (($reasons | Select-Object -Unique) -join '|')
        }
        $row | Export-Csv -LiteralPath $csvPath -NoTypeInformation -Encoding UTF8 -Append
        $sampleCount++
        $previous = $current
        $previousUtc = $sampleUtc
        $previousElapsed = $sampleElapsed
        if ($sampleElapsed -ge $DurationSeconds) { $status = 'completed'; break }
        $waitMilliseconds = [Math]::Max(1, [Math]::Min($IntervalSeconds * 1000, ($DurationSeconds - $sampleElapsed) * 1000))
        Start-Sleep -Milliseconds ([int]$waitMilliseconds)
    }
} catch {
    $failure = $_.Exception.Message
    $status = 'failed'
} finally {
    $clock.Stop()
    $metadata['finishedUtc'] = [DateTime]::UtcNow.ToString('o')
    $metadata['actualElapsedSeconds'] = [Math]::Round($clock.Elapsed.TotalSeconds, 4)
    $metadata['sampleCount'] = $sampleCount
    $metadata['incompleteCpuSamples'] = $incompleteCpuSamples
    $metadata['observedProcesses'] = @($observed.Values)
    $metadata['status'] = $status
    $metadata['failure'] = $failure
    $metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $metadataPath -Encoding UTF8
    $rootProcess.Dispose()
}

Write-Output "Estado: $status. Muestras: $sampleCount. CPU incompleta: $incompleteCpuSamples."
Write-Output "CSV: $csvPath"
Write-Output "Metadatos: $metadataPath"
if ($failure) { throw $failure }
if ($status -eq 'root-exited') { Write-Warning 'Nivo termino antes de completar la duracion. Esta medicion no acredita el ensayo completo.' }
