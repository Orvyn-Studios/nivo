param([ValidateSet('Drag','Save','Cancel')][string]$Action='Drag',[int]$NivoId,[string]$FixturePath,[int]$X,[int]$Y)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if($Action -eq 'Drag') {
  if(-not (Test-Path -LiteralPath $FixturePath -PathType Leaf)){throw 'Missing owned test file'}
  $sourceExe=Join-Path $PSScriptRoot ('../artifacts/actions/native/ole-source-'+[guid]::NewGuid().ToString('N')+'.exe')
  Add-Type -OutputAssembly $sourceExe -OutputType ConsoleApplication -ReferencedAssemblies System.Windows.Forms,System.Drawing @'
using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
public static class DropPointer {
 [STAThread] public static void Main(string[] args){Console.WriteLine(Run(args[0],int.Parse(args[1]),int.Parse(args[2])));}
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point p);
 [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
 [StructLayout(LayoutKind.Sequential)] public struct MOUSEINPUT {public int dx,dy;public uint data,flags,time;public UIntPtr extra;}
 [StructLayout(LayoutKind.Sequential)] public struct INPUT {public uint type;public MOUSEINPUT mouse;}
 [DllImport("user32.dll")] public static extern int GetSystemMetrics(int index);
 [DllImport("user32.dll",SetLastError=true)] public static extern uint SendInput(uint count,INPUT[] inputs,int size);
 public static void Input(uint flags,int x=0,int y=0){
  var i=new INPUT {mouse=new MOUSEINPUT {flags=flags}};
  if((flags&1)!=0){i.mouse.dx=(int)Math.Round((x-GetSystemMetrics(76))*65535.0/Math.Max(1,GetSystemMetrics(78)-1));i.mouse.dy=(int)Math.Round((y-GetSystemMetrics(77))*65535.0/Math.Max(1,GetSystemMetrics(79)-1));}
  if(SendInput(1,new INPUT[]{i},Marshal.SizeOf(typeof(INPUT)))!=1)throw new Exception("Windows rejected owned fixture input.");
 }
 public static string Run(string file,int x,int y){
  Point saved;GetCursorPos(out saved);
  var deadline=new System.Threading.Thread(new System.Threading.ThreadStart(()=>{
   System.Threading.Thread.Sleep(6000);mouse_event(4,0,0,0,UIntPtr.Zero);SetCursorPos(saved.X,saved.Y);Console.Error.WriteLine("Owned OLE source did not return within six seconds.");Environment.Exit(3);
  }));deadline.IsBackground=true;deadline.Start();
  using(var form=new Form()){
   form.Text="Nivo owned OLE test fixture";form.Width=220;form.Height=90;
   form.StartPosition=FormStartPosition.Manual;form.Left=30;form.Top=250;form.TopMost=true;
   var data=new DataObject(DataFormats.FileDrop,new string[]{file});string effect="None";
   var started=DateTime.UtcNow;int queries=0;
   form.QueryContinueDrag+=(sender,args)=>{
    if(++queries<=3)Console.Error.WriteLine("Owned OLE query state: "+args.KeyState+" / "+args.Action);
    if((DateTime.UtcNow-started).TotalMilliseconds>800)args.Action=DragAction.Drop;
   };
   form.Shown+=(sender,args)=>form.BeginInvoke(new Action(()=>{
    Console.Error.WriteLine("Owned source shown; entering OLE.");
    Input(0xC001,form.Left+90,form.Top+45);Input(2);
    var pointer=new System.Threading.Thread(new System.Threading.ThreadStart(()=>{
     System.Threading.Thread.Sleep(250);Input(0xC001,x,y);Console.Error.WriteLine("Owned pointer moved.");System.Threading.Thread.Sleep(750);Input(4);Console.Error.WriteLine("Owned button released.");
    }));pointer.IsBackground=true;pointer.Start();
    try{effect=form.DoDragDrop(data,DragDropEffects.Copy).ToString();}
    finally{mouse_event(4,0,0,0,UIntPtr.Zero);form.Close();}
   }));
   try{Application.Run(form);return effect;}finally{SetCursorPos(saved.X,saved.Y);}
  }
 }
}
'@
  [Console]::Error.WriteLine('Owned OLE fixture compiled; starting form.')
  $effect=& $sourceExe $FixturePath $X $Y
  if($LASTEXITCODE -ne 0){throw 'Owned OLE source could not complete a native drag in this environment.'}
  @{action='Drag';effect=$effect;provider='owned WinForms OLE fixture, not Explorer'} | ConvertTo-Json -Compress
  exit
}
$root=[System.Windows.Automation.AutomationElement]::RootElement
$pidCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty,$NivoId)
$windows=$root.FindAll([System.Windows.Automation.TreeScope]::Children,$pidCondition)
$dialog=$null
foreach($window in $windows){if($window.Current.ClassName -eq '#32770'){$dialog=$window;break}}
if($null -eq $dialog){throw 'Owned Nivo save dialog not found'}
$scope=[System.Windows.Automation.TreeScope]::Descendants
if($Action -eq 'Save') {
  $editCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty,[System.Windows.Automation.ControlType]::Edit)
  $edits=$dialog.FindAll($scope,$editCondition);$fileEdit=$null
  foreach($edit in $edits){
    $value=$null
    if($edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern,[ref]$value)){
      if($value.Current.Value -match '\.(zip|txt)$'){$fileEdit=$value;break}
    }
  }
  if($null -eq $fileEdit){throw 'Owned file-name edit not found'}
  $fileEdit.SetValue($FixturePath)
}
$buttonId=if($Action -eq 'Save'){'1'}else{'2'}
$buttonCondition=New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty,$buttonId)
$button=$dialog.FindFirst($scope,$buttonCondition)
if($null -eq $button){throw 'Owned dialog button not found'}
$pattern=$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$pattern.Invoke()
@{action=$Action;ownedProcessId=$NivoId} | ConvertTo-Json -Compress
