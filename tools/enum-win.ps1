param([int]$TargetPid)
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class EW {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassNameW(IntPtr h, StringBuilder s, int n);
  public static List<string> List(uint target) {
    var r = new List<string>();
    EnumWindows((h,l) => {
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == target) {
        var sb = new StringBuilder(256); GetWindowTextW(h, sb, 256);
        var cb = new StringBuilder(256); GetClassNameW(h, cb, 256);
        IntPtr own = GetWindow(h, 4);
        r.Add(string.Format("hwnd={0} vis={1} owner={2} class={3} title={4}", h.ToInt64(), IsWindowVisible(h), own.ToInt64(), cb.ToString(), sb.ToString()));
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
'@
[EW]::List([uint32]$TargetPid) | ForEach-Object { $_ }
