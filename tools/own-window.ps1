param([long]$Child, [long]$Owner)
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Win32 {
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr GetWindow(IntPtr hWnd, uint uCmd);
  [DllImport("user32.dll", SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);
}
'@
$GW_OWNER = 4
$GWLP_HWNDPARENT = -8
$c = [IntPtr]$Child
$o = [IntPtr]$Owner
$before = [Win32]::GetWindow($c, $GW_OWNER)
[Win32]::SetWindowLongPtr($c, $GWLP_HWNDPARENT, $o) | Out-Null
Start-Sleep -Milliseconds 300
$after = [Win32]::GetWindow($c, $GW_OWNER)
"owner_before=$($before.ToInt64()) owner_after=$($after.ToInt64()) expected_owner=$Owner"
