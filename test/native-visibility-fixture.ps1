param([Parameter(Mandatory)][int]$NivoId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
# Finite external test window. Commands arrive on stdin. A bounded click may
# activate only our verified fixture; the cursor is restored. No other app or
# global settings are modified, and no product polling is introduced.
Add-Type -ReferencedAssemblies System.Windows.Forms,System.Drawing -TypeDefinition @'
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using System.Drawing;
public static class NivoVisibilityFixture {
  delegate bool Callback(IntPtr hwnd,IntPtr data);
  [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
  [StructLayout(LayoutKind.Sequential)] struct Point {public int x,y;}
  [DllImport("user32.dll")] static extern bool EnumWindows(Callback callback,IntPtr data);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hwnd,System.Text.StringBuilder text,int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd,out Rect rect);
  [DllImport("user32.dll")] static extern int GetWindowRgn(IntPtr hwnd,IntPtr region);
  [DllImport("user32.dll")] static extern IntPtr GetWindowLongPtrW(IntPtr hwnd,int index);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,uint flags);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
  [StructLayout(LayoutKind.Sequential)] struct MouseInput {public int x,y;public uint data,flags,time;public UIntPtr extra;}
  [StructLayout(LayoutKind.Sequential)] struct Input {public uint type;public MouseInput mouse;}
  [DllImport("user32.dll",SetLastError=true)] static extern uint SendInput(uint count,Input[] inputs,int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  static void ClickOwned(Point point){
    var move=new Input{mouse=new MouseInput{x=(int)Math.Round((point.x-GetSystemMetrics(76))*65535.0/Math.Max(1,GetSystemMetrics(78)-1)),y=(int)Math.Round((point.y-GetSystemMetrics(77))*65535.0/Math.Max(1,GetSystemMetrics(79)-1)),flags=0xC001}};
    var down=new Input{mouse=new MouseInput{flags=2}};var up=new Input{mouse=new MouseInput{flags=4}};
    if(SendInput(3,new[]{move,down,up},Marshal.SizeOf(typeof(Input)))!=3)throw new Exception("Windows rejected the owned fixture click.");
    // Let the actual input messages reach this form before restoring position
    // and z-order; otherwise the fallback can demote itself ahead of activation.
    Application.DoEvents();Thread.Sleep(30);Application.DoEvents();
  }
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd,int attribute,out Rect rect,int size);
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
  [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr region,out Rect rect);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
  public static void Run(uint pid) {
    IntPtr island=IntPtr.Zero,region=CreateRectRgn(0,0,0,0);
    try {
      EnumWindows((hwnd,data)=>{uint id;GetWindowThreadProcessId(hwnd,out id);if(id==pid){var title=new System.Text.StringBuilder(128);GetWindowTextW(hwnd,title,128);if(title.ToString()=="Nivo by Orvyn"&&GetWindowRgn(hwnd,region)>0){island=hwnd;return false;}}return true;},IntPtr.Zero);
      if(island==IntPtr.Zero)throw new Exception("No Nivo island with native region.");
      Rect initial;GetWindowRect(island,out initial);
      var screen=Screen.FromPoint(new System.Drawing.Point(initial.left+100,initial.top+20));
      var form=new Form{Text="Nivo — prueba de visibilidad",StartPosition=FormStartPosition.Manual,Bounds=screen.WorkingArea,BackColor=Color.FromArgb(28,29,32)};
      var queue=new ConcurrentQueue<string>();
      ThreadPool.QueueUserWorkItem(_=>{string line;while((line=Console.ReadLine())!=null)queue.Enqueue(line);queue.Enqueue("close");});
      Action report=()=>{
        Rect window,bounds;GetWindowRect(island,out window);GetWindowRgn(island,region);GetRgnBox(region,out bounds);
        var hit=WindowFromPoint(new Point{x=window.left+(bounds.left+bounds.right)/2,y=window.top+(bounds.top+bounds.bottom)/2});
        Rect outer,frame;GetWindowRect(form.Handle,out outer);DwmGetWindowAttribute(form.Handle,9,out frame,16);
        Console.WriteLine("{\"visible\":"+IsWindowVisible(island).ToString().ToLowerInvariant()+",\"topmost\":"+((GetWindowLongPtrW(island,-20).ToInt64()&8)!=0).ToString().ToLowerInvariant()+",\"islandOwnsPoint\":"+(hit==island||IsChild(island,hit)).ToString().ToLowerInvariant()+",\"fixtureForeground\":"+(GetForegroundWindow()==form.Handle).ToString().ToLowerInvariant()+",\"fixtureRect\":\""+outer.left+","+outer.top+","+outer.right+","+outer.bottom+"\",\"frameRect\":\""+frame.left+","+frame.top+","+frame.right+","+frame.bottom+"\"}");
        Console.Out.Flush();
      };
      var timer=new System.Windows.Forms.Timer{Interval=30};var started=DateTime.UtcNow;
      timer.Tick+=(s,e)=>{
        if((DateTime.UtcNow-started).TotalSeconds>45){form.Close();return;}
        string command;if(!queue.TryDequeue(out command))return;
        if(command=="close"){form.Close();return;}
        if(command=="normal"||command=="fullscreen"){
          form.WindowState=FormWindowState.Normal;
          form.FormBorderStyle=command=="fullscreen"?FormBorderStyle.None:FormBorderStyle.Sizable;
          form.Bounds=command=="fullscreen"?screen.Bounds:screen.WorkingArea;
          form.Activate();SetForegroundWindow(form.Handle);
          SetWindowPos(form.Handle,IntPtr.Zero,0,0,0,0,1|2|16);
          if(GetForegroundWindow()!=form.Handle){
            SetWindowPos(form.Handle,new IntPtr(-1),0,0,0,0,1|2|16);
            Point saved;GetCursorPos(out saved);
            var center=new Point{x=screen.Bounds.Left+screen.Bounds.Width/2,y=screen.Bounds.Top+screen.Bounds.Height/2};
            var target=WindowFromPoint(center);
            // Windows may deny programmatic foreground activation. Click only
            // our verified fixture surface, then restore the physical pointer.
            if(target==form.Handle||IsChild(form.Handle,target)){
              try {ClickOwned(center);}
              finally {SetCursorPos(saved.x,saved.y);}
            }
            SetWindowPos(form.Handle,new IntPtr(-2),0,0,0,0,1|2|16);
          }
        }
        report();
      };
      form.Shown+=(s,e)=>{form.Activate();SetForegroundWindow(form.Handle);report();timer.Start();};
      Application.Run(form);timer.Dispose();form.Dispose();
    } finally {DeleteObject(region);}
  }
}
'@
[NivoVisibilityFixture]::Run([uint32]$NivoId)
