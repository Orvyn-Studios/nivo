param(
  [ValidateSet('snapshot', 'move', 'restore')][string]$Action = 'snapshot',
  [int]$X = 0,
  [int]$Y = 0
)
$ErrorActionPreference = 'Stop'
# Test-only desktop pointer movement; no clicks, hooks, registration or policy changes.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NivoCursorProbe {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {
    public int dx, dy; public uint mouseData, flags, time; public UIntPtr extra;
  }
  [StructLayout(LayoutKind.Sequential)] public struct INPUT { public uint type; public MOUSEINPUT mouse; }
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT point);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint count, INPUT[] inputs, int size);
  public static bool Move(int x, int y) {
    int left=GetSystemMetrics(76), top=GetSystemMetrics(77), width=GetSystemMetrics(78), height=GetSystemMetrics(79);
    var input=new INPUT { type=0, mouse=new MOUSEINPUT {
      dx=(int)Math.Round((x-left)*65535.0/Math.Max(1,width-1)),
      dy=(int)Math.Round((y-top)*65535.0/Math.Max(1,height-1)), flags=0xC001
    }};
    return SendInput(1,new[]{input},Marshal.SizeOf(typeof(INPUT)))==1;
  }
}
'@
[void][NivoCursorProbe]::SetThreadDpiAwarenessContext([IntPtr](-4))
if ($Action -eq 'move') {
  if (-not [NivoCursorProbe]::Move($X, $Y)) { throw 'Windows rejected test pointer movement.' }
} elseif ($Action -eq 'restore') {
  if (-not [NivoCursorProbe]::SetCursorPos($X, $Y)) { throw 'Cannot restore pointer position.' }
}
$point = New-Object NivoCursorProbe+POINT
if (-not [NivoCursorProbe]::GetCursorPos([ref]$point)) { throw 'Cannot read desktop cursor.' }
@{
  x=$point.x; y=$point.y;
  left=[NivoCursorProbe]::GetSystemMetrics(76); top=[NivoCursorProbe]::GetSystemMetrics(77);
  width=[NivoCursorProbe]::GetSystemMetrics(78); height=[NivoCursorProbe]::GetSystemMetrics(79)
} | ConvertTo-Json -Compress
