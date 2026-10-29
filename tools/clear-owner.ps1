param([long]$Hwnd)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class CO{[DllImport("user32.dll",SetLastError=true)]public static extern IntPtr SetWindowLongPtr(IntPtr h,int i,IntPtr v);[DllImport("user32.dll")]public static extern IntPtr GetWindow(IntPtr h,uint c);}
'@
$h=[IntPtr]$Hwnd
[CO]::SetWindowLongPtr($h,-8,[IntPtr]::Zero) | Out-Null
Start-Sleep -Milliseconds 200
$o=[CO]::GetWindow($h,4)
"owner_now=$($o.ToInt64())"
