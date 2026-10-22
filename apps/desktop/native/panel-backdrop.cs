// Drawing-only child HWND. HostBackdropBrush samples the desktop inside DWM;
// no pixel readback, microphone, network, task state or product IPC is available.
using System;
using System.Globalization;
using System.Numerics;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Windows.UI;
using Windows.UI.Composition;
using Windows.UI.Composition.Desktop;

class PanelBackdrop {
 [StructLayout(LayoutKind.Sequential)] struct QueueOptions {public int size,type,apartment;}
 [StructLayout(LayoutKind.Sequential)] struct Rect {public int left,top,right,bottom;}
 [DllImport("CoreMessaging.dll")] static extern int CreateDispatcherQueueController(QueueOptions options,out IntPtr controller);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateWindowEx(int ex,string name,string title,int style,int x,int y,int w,int h,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd,out uint pid);
 [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hwnd,out Rect rect);
 [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hwnd,IntPtr after,int x,int y,int w,int h,int flags);
 [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr hwnd);
 [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd,int attr,ref int val,int size);
 [ComImport,Guid("29E691FA-4567-4DCA-B319-D0F207EB6807"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface DesktopInterop {
  void CreateDesktopWindowTarget(IntPtr hwnd,[MarshalAs(UnmanagedType.Bool)] bool topmost,[MarshalAs(UnmanagedType.IInspectable)] out object target);
 }
 static volatile string pending;
 static volatile bool inputClosed;
 [STAThread] static void Main(string[] args) {
  IntPtr child=IntPtr.Zero;
  try {
   long handle;uint owner;
   if(args.Length!=2||!long.TryParse(args[0],out handle)||handle<=0||!uint.TryParse(args[1],out owner))throw new ArgumentException("Invalid owner");
   var parent=new IntPtr(handle);uint actual;
   if(!IsWindow(parent)||GetWindowThreadProcessId(parent,out actual)==0||actual!=owner)throw new ArgumentException("Invalid window owner");
   SetProcessDpiAwarenessContext(new IntPtr(-4));
   IntPtr queue;Marshal.ThrowExceptionForHR(CreateDispatcherQueueController(new QueueOptions {size=12,type=2,apartment=2},out queue));
   // NOREDIRECTIONBITMAP | TRANSPARENT | NOACTIVATE; child is below Chromium.
   child=CreateWindowEx(0x08200020,"Static","PersonalAgent Glass",unchecked((int)0x50000000),0,0,1,1,parent,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
   if(child==IntPtr.Zero)throw new InvalidOperationException("Backdrop child unavailable");
   int yes=1;Marshal.ThrowExceptionForHR(DwmSetWindowAttribute(parent,17,ref yes,4));
   var compositor=new Compositor();object raw;
   ((DesktopInterop)(object)compositor).CreateDesktopWindowTarget(child,false,out raw);
   var target=(DesktopWindowTarget)raw;
   var root=compositor.CreateContainerVisual();target.Root=root;
   var backdrop=compositor.CreateSpriteVisual();backdrop.Brush=compositor.CreateHostBackdropBrush();root.Children.InsertAtBottom(backdrop);
   var tint=compositor.CreateSpriteVisual();var tintBrush=compositor.CreateColorBrush();tint.Brush=tintBrush;root.Children.InsertAtTop(tint);
   var geometry=compositor.CreateRoundedRectangleGeometry();root.Clip=compositor.CreateGeometricClip(geometry);
   string theme="dark",lastTheme="";float radius=40,lastRadius=-1;int lastWidth=-1,lastHeight=-1;long lastRevision=-1;
   Action update=()=>{
    if(!IsWindow(parent)||GetWindowThreadProcessId(parent,out actual)==0||actual!=owner||inputClosed){Application.ExitThread();return;}
    var line=Interlocked.Exchange(ref pending,null);
    if(line!=null){var fields=line.Split('|');float next;long revision;if(fields.Length==4&&fields[0]=="1"&&long.TryParse(fields[1],out revision)&&revision>=0&&revision>lastRevision&&(fields[2]=="dark"||fields[2]=="light")&&float.TryParse(fields[3],NumberStyles.Float,CultureInfo.InvariantCulture,out next)&&next>=1&&next<=200){theme=fields[2];radius=next;lastRevision=revision;}}
    Rect rect;if(!GetClientRect(parent,out rect))return;
    int width=rect.right,height=rect.bottom;if(width<=0||height<=0)return;
    float pixels=radius*Math.Max(96,GetDpiForWindow(parent))/96;
    if(width!=lastWidth||height!=lastHeight||pixels!=lastRadius){
     root.Size=backdrop.Size=tint.Size=geometry.Size=new Vector2(width,height);
     var r=Math.Min(pixels,Math.Min(width,height)/2f);geometry.CornerRadius=new Vector2(r,r);
     SetWindowPos(child,new IntPtr(1),0,0,width,height,0x0010);
     lastWidth=width;lastHeight=height;lastRadius=pixels;
    }
    if(theme!=lastTheme){tintBrush.Color=theme=="dark"?Color.FromArgb(160,20,24,30):Color.FromArgb(90,244,247,251);lastTheme=theme;}
   };
   update();Console.WriteLine("READY|1");Console.Out.Flush();
   var reader=new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length<=64)pending=line;}}finally{inputClosed=true;}});reader.IsBackground=true;reader.Start();
   var timer=new System.Windows.Forms.Timer();timer.Interval=80;timer.Tick+=(s,e)=>update();timer.Start();
   Application.Run();timer.Dispose();
   GC.KeepAlive(target);GC.KeepAlive(compositor);GC.KeepAlive(queue);
  }catch(Exception){Console.Error.WriteLine("Panel backdrop unavailable");Environment.ExitCode=1;}
  finally{if(child!=IntPtr.Zero&&IsWindow(child))DestroyWindow(child);}
 }
}
