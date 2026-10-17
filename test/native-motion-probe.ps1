param([Parameter(Mandatory)][int]$NivoId,[ValidateRange(100,60000)][int]$DurationMs=20000)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class NivoMotionProbe {
  public delegate bool Callback(IntPtr hwnd,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left,top,right,bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x,y; }
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd,IntPtr region);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr hwnd,int index);
  [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr hwnd);
  [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hwnd,IntPtr dc);
  [DllImport("gdi32.dll")] static extern int GetDeviceCaps(IntPtr dc,int index);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
  [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region,out Rect rect);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
  public sealed class Sample {
    public double wallMs,elapsedMs;
    public int windowX,windowY,clientWidth,clientHeight,left,top,right,bottom;
    public bool exteriorOwnsPointer,roundedCornerOwnsPointer,foreground;
  }
  public sealed class Result {
    public int displayRefreshReportedHz;
    public uint dpi;
    public long extendedStyle;
    public List<Sample> samples=new List<Sample>();
  }
  static bool Owns(IntPtr hwnd,int x,int y) {
    var target=WindowFromPoint(new Point{x=x,y=y});
    return target==hwnd||IsChild(hwnd,target);
  }
  public static Result Read(uint pid,int durationMs) {
    IntPtr own=IntPtr.Zero;
    var candidate=CreateRectRgn(0,0,0,0);
    try { EnumWindows((hwnd,data)=>{uint id;GetWindowThreadProcessId(hwnd,out id);if(id==pid&&IsWindowVisible(hwnd)&&GetWindowRgn(hwnd,candidate)>0){own=hwnd;return false;}return true;},IntPtr.Zero); }
    finally { DeleteObject(candidate); }
    if(own==IntPtr.Zero)throw new Exception("No visible Nivo window for finite region probe.");
    var result=new Result{dpi=GetDpiForWindow(own),extendedStyle=GetWindowLongPtrW(own,-20).ToInt64()};
    var dc=GetDC(IntPtr.Zero);try{result.displayRefreshReportedHz=GetDeviceCaps(dc,116);}finally{ReleaseDC(IntPtr.Zero,dc);}
    var region=CreateRectRgn(0,0,0,0);var clock=Stopwatch.StartNew();
    try {
      while(clock.ElapsedMilliseconds<durationMs&&IsWindow(own)) {
        Rect window,client,bounds;
        if(GetWindowRect(own,out window)&&GetClientRect(own,out client)&&GetWindowRgn(own,region)>0) {
          GetRgnBox(region,out bounds);
          result.samples.Add(new Sample {
            wallMs=(DateTime.UtcNow-new DateTime(1970,1,1)).TotalMilliseconds,elapsedMs=clock.Elapsed.TotalMilliseconds,
            windowX=window.left,windowY=window.top,clientWidth=client.right,clientHeight=client.bottom,
            left=bounds.left,top=bounds.top,right=bounds.right,bottom=bounds.bottom,
            exteriorOwnsPointer=Owns(own,window.left+1,window.top+1),
            roundedCornerOwnsPointer=Owns(own,window.left+bounds.left,window.top+bounds.top),foreground=GetForegroundWindow()==own
          });
        }
        System.Threading.Thread.Sleep(5);
      }
    }finally{DeleteObject(region);}
    return result;
  }
}
'@
[NivoMotionProbe]::Read([uint32]$NivoId,$DurationMs) | ConvertTo-Json -Depth 6 -Compress
