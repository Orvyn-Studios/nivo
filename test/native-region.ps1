param([Parameter(Mandatory)][int]$NivoId)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NivoRegionProbe {
    public delegate bool Callback(IntPtr hwnd, IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
    [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback, IntPtr data);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
    [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd, IntPtr region);
    [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
    [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
    [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region,out Rect rect);
    [DllImport("gdi32.dll")] static extern bool PtInRegion(IntPtr region,int x,int y);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    public static double[] Read(uint target) {
        IntPtr own = IntPtr.Zero;
        EnumWindows((hwnd, data) => { uint pid; GetWindowThreadProcessId(hwnd, out pid); if(pid == target && IsWindowVisible(hwnd)) { own=hwnd; return false; } return true; }, IntPtr.Zero);
        if(own==IntPtr.Zero) throw new Exception("No visible Nivo window.");
        IntPtr region=CreateRectRgn(0,0,0,0);
        try {
            if(GetWindowRgn(own,region)==0) throw new Exception("No explicit Nivo region.");
            Rect bounds; GetRgnBox(region,out bounds);
            return new double[] { bounds.Right-bounds.Left, bounds.Bottom-bounds.Top, GetDpiForWindow(own)/96.0,
                PtInRegion(region,0,0)?1:0, PtInRegion(region,(bounds.Left+bounds.Right)/2,(bounds.Top+bounds.Bottom)/2)?1:0,
                PtInRegion(region,bounds.Left,bounds.Top)?1:0 };
        } finally { DeleteObject(region); }
    }
}
'@
$value = [NivoRegionProbe]::Read($NivoId)
@{ width=$value[0]; height=$value[1]; scale=$value[2]; outerCornerHits=($value[3] -eq 1); centerHits=($value[4] -eq 1); roundedCornerHits=($value[5] -eq 1) } | ConvertTo-Json -Compress
