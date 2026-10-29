param([int]$ProcId)
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class PA2 {
  [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint a, bool i, int p);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] public static extern int GetApplicationUserModelId(IntPtr h, ref uint len, StringBuilder buf);
}
'@
$h = [PA2]::OpenProcess(0x1000, $false, $ProcId)
if($h -eq [IntPtr]::Zero){ Write-Output "pid $ProcId : openfail"; exit }
$len = [uint32]256
$sb = New-Object System.Text.StringBuilder 256
$r = [PA2]::GetApplicationUserModelId($h, [ref]$len, $sb)
Write-Output ("pid " + $ProcId + " : hr=" + $r + " len=" + $len + " AUMID=[" + $sb.ToString() + "]")
[PA2]::CloseHandle($h) | Out-Null
