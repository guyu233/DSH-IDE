Add-Type @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPropertyStore {
  int GetCount(out uint c);
  int GetAt(uint i, out PROPERTYKEY k);
  int GetValue(ref PROPERTYKEY k, out PROPVARIANT v);
  int SetValue(ref PROPERTYKEY k, ref PROPVARIANT v);
  int Commit();
}
[StructLayout(LayoutKind.Sequential)] struct PROPERTYKEY { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Sequential)] struct PROPVARIANT { public ushort vt; public ushort r1; public ushort r2; public ushort r3; public IntPtr p; public int p2; }
public class AU {
  [DllImport("shell32.dll")] static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore pp);
  public static string Get(long hwnd) {
    Guid iid = new Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99");
    IPropertyStore store;
    int hr = SHGetPropertyStoreForWindow((IntPtr)hwnd, ref iid, out store);
    if (hr != 0 || store == null) return "ERR hr=" + hr;
    PROPERTYKEY key; key.fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"); key.pid = 5; // System.AppUserModel.ID
    PROPVARIANT v;
    int hr2 = store.GetValue(ref key, out v);
    if (hr2 != 0) return "NOVALUE hr=" + hr2;
    string s = Marshal.PtrToStringUni(v.p);
    return s ?? "(empty)";
  }
}
'@
$targets = @{ 'DSH(526822)' = 526822 }
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" | ForEach-Object {
	$p = Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue
	if ($p -and $p.MainWindowTitle -and $p.MainWindowTitle -ne '') {
		$targets["${($p.Id)}:$($p.MainWindowTitle)"] = [int64]$p.MainWindowHandle
	}
}
foreach ($k in $targets.Keys) {
	$hw = $targets[$k]
	if ($hw -ne 0) { Write-Output ("AUMID[" + $k + "] = " + [AU]::Get([int64]$hw)) }
}
