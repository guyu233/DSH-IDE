param([int]$Pid1,[int]$Pid2)
Add-Type @'
using System;using System.Runtime.InteropServices;
public class JC{
 [DllImport("kernel32.dll",SetLastError=true)] public static extern IntPtr OpenProcess(uint a,bool i,int p);
 [DllImport("kernel32.dll",SetLastError=true)] public static extern bool IsProcessInJob(IntPtr p,IntPtr j,out bool r);
 [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
'@
function InJob([int]$p){
 $h=[JC]::OpenProcess(0x1000,$false,$p)  # PROCESS_QUERY_LIMITED_INFORMATION
 if($h -eq [IntPtr]::Zero){ return "openfail" }
 $r=$false
 [JC]::IsProcessInJob($h,[IntPtr]::Zero,[ref]$r) | Out-Null
 [JC]::CloseHandle($h) | Out-Null
 return $r
}
"pid $Pid1 inJob=" + (InJob $Pid1)
"pid $Pid2 inJob=" + (InJob $Pid2)
