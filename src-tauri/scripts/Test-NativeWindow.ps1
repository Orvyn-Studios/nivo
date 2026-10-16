param(
    [Parameter(Mandatory = $true)][string]$Executable,
    [ValidateRange(5, 60)][int]$TimeoutSeconds = 20,
    [switch]$KeepOpen
)

$ErrorActionPreference = 'Stop'
# Use an executable produced by `npm run build` / `tauri build` so frontend
# assets are embedded. Raw `cargo build` without tauri/custom-protocol needs Vite.
$appPath = (Resolve-Path -LiteralPath $Executable).Path
if ([IO.Path]::GetExtension($appPath) -ne '.exe') { throw 'Executable must point to a compiled Nivo .exe.' }

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class NivoWindowAudit {
    public delegate bool EnumCallback(IntPtr hwnd, IntPtr parameter);
    [StructLayout(LayoutKind.Sequential)]
    public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hwnd, out Rect rect);
    [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("user32.dll")] public static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr hwnd, uint message, IntPtr wParam, IntPtr lParam);
    [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] private static extern IntPtr GetWindowLong64(IntPtr hwnd, int index);
    [DllImport("user32.dll", EntryPoint="GetWindowLongW")] private static extern int GetWindowLong32(IntPtr hwnd, int index);
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRectRgn(int left, int top, int right, int bottom);
    [DllImport("gdi32.dll")] public static extern bool PtInRegion(IntPtr region, int x, int y);
    [DllImport("gdi32.dll")] public static extern bool DeleteObject(IntPtr handle);

    public static long ExtendedStyle(IntPtr hwnd) {
        return IntPtr.Size == 8 ? GetWindowLong64(hwnd, -20).ToInt64() : GetWindowLong32(hwnd, -20);
    }
    public static IntPtr VisibleWindow(uint processId) {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr hwnd, IntPtr parameter) {
            uint candidate;
            GetWindowThreadProcessId(hwnd, out candidate);
            if (candidate == processId && IsWindowVisible(hwnd)) { result = hwnd; return false; }
            return true;
        }, IntPtr.Zero);
        return result;
    }
}
'@

$foregroundBefore = [NivoWindowAudit]::GetForegroundWindow()
$process = Start-Process -FilePath $appPath -PassThru -WindowStyle Hidden
$window = [IntPtr]::Zero
$clock = [Diagnostics.Stopwatch]::StartNew()
try {
    while ($clock.Elapsed.TotalSeconds -lt $TimeoutSeconds) {
        if ($process.HasExited) { throw "Nivo exited before showing its island (exit $($process.ExitCode))." }
        $window = [NivoWindowAudit]::VisibleWindow([uint32]$process.Id)
        if ($window -ne [IntPtr]::Zero) { break }
        Start-Sleep -Milliseconds 100
    }
    if ($window -eq [IntPtr]::Zero) { throw "No visible Nivo window within $TimeoutSeconds seconds." }
    $startupMs = $clock.Elapsed.TotalMilliseconds
    $foregroundAfter = [NivoWindowAudit]::GetForegroundWindow()
    if ($foregroundBefore -eq [IntPtr]::Zero) { throw 'Could not measure the original foreground window; focus acceptance is unverified.' }
    if ($foregroundBefore -ne [IntPtr]::Zero -and $foregroundBefore -ne $foregroundAfter) {
        throw 'Foreground changed during startup. Repeat without interacting with the desktop and investigate focus.'
    }
    $style = [NivoWindowAudit]::ExtendedStyle($window)
    if (($style -band 0x80) -eq 0) { throw 'WS_EX_TOOLWINDOW was not applied.' }
    if (($style -band 0x40000) -ne 0) { throw 'WS_EX_APPWINDOW remains set.' }
    if (($style -band 0x8) -ne 0) { throw 'Topmost is enabled before fullscreen acceptance.' }
    if (($style -band 0x08000000) -ne 0) { throw 'Permanent NOACTIVATE would block intentional keyboard access.' }

    $rect = New-Object NivoWindowAudit+Rect
    if (-not [NivoWindowAudit]::GetWindowRect($window, [ref]$rect)) { throw 'GetWindowRect failed.' }
    $dpi = [NivoWindowAudit]::GetDpiForWindow($window)
    if ($dpi -eq 0) { throw 'GetDpiForWindow failed.' }
    $scale = $dpi / 96.0
    $width = $rect.Right - $rect.Left
    $height = $rect.Bottom - $rect.Top
    if ([Math]::Abs($width - [Math]::Round(144 * $scale)) -gt 1 -or [Math]::Abs($height - [Math]::Round(66 * $scale)) -gt 1) {
        throw "Unexpected compact geometry ${width}x${height} at DPI $dpi. Test with a monitor whose work area can fit the capsule."
    }

    $region = [NivoWindowAudit]::CreateRectRgn(0, 0, 0, 0)
    if ($region -eq [IntPtr]::Zero) { throw 'CreateRectRgn failed.' }
    try {
        if ([NivoWindowAudit]::GetWindowRgn($window, $region) -eq 0) { throw 'Nivo has no native hit region.' }
        if ([NivoWindowAudit]::PtInRegion($region, 0, 0)) { throw 'Transparent margin intercepts input.' }
        if ([NivoWindowAudit]::PtInRegion($region, [int][Math]::Round(16 * $scale), [int][Math]::Round(16 * $scale))) {
            throw 'Rounded capsule corner intercepts input.'
        }
        if (-not [NivoWindowAudit]::PtInRegion($region, [int]($width / 2), [int]($height / 2))) { throw 'Capsule center is not interactive.' }
    } finally { [void][NivoWindowAudit]::DeleteObject($region) }

    [PSCustomObject]@{
        Result = 'PASS'
        ProcessId = $process.Id
        StartupToVisibleMs = [Math]::Round($startupMs, 2)
        X = $rect.Left
        Y = $rect.Top
        Width = $width
        Height = $height
        Dpi = $dpi
        ToolWindow = $true
        Topmost = $false
        ForegroundPreserved = $true
        NativeRegion = $true
    } | ConvertTo-Json
} finally {
    if (-not $KeepOpen -and -not $process.HasExited) {
        if ($window -ne [IntPtr]::Zero) {
            [void][NivoWindowAudit]::PostMessage($window, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
            if (-not $process.WaitForExit(5000)) { Write-Warning 'Nivo did not close within five seconds; its process remains open for investigation.' }
        } else {
            Write-Warning "The launched process $($process.Id) remains open because no window was found."
        }
    }
}
