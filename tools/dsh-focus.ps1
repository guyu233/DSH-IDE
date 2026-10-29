# Bring the DeepSeek Harness desktop main window to the foreground (NOT the DSH-IDE window).
# Identify by process executable path (DSH install dir), not by window title -- titles change per session,
# and matching by title caused false "not found" -> duplicate launch -> old window closed/reopened.
# Report 'not-running' only when no DSH process exists at all; Host decides whether to launch.
param([string]$Folder = "")
$ErrorActionPreference = 'SilentlyContinue'
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class DshWin {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool BringWindowToTop(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int X, int Y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
}
"@

# DSH desktop processes = name 'DeepSeek Harness', exe in the DSH install dir (exclude the E:\vscode-dsh IDE copy).
$allDsh = Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue | Where-Object {
  $_.Path -and ($_.Path -notlike '*vscode-dsh*')
}
if (-not $allDsh) {
  Write-Output (@{ ok = $false; reason = 'not-running'; folder = $Folder } | ConvertTo-Json -Compress)
  exit 0
}
$target = $allDsh | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $target) {
  $any = ($allDsh | Select-Object -First 1)
  Write-Output (@{ ok = $false; reason = 'no-window'; pid = $any.Id; folder = $Folder } | ConvertTo-Json -Compress)
  exit 0
}
$h = $target.MainWindowHandle
if ([DshWin]::IsIconic($h)) { [void][DshWin]::ShowWindow($h, 9) } # SW_RESTORE
[void][DshWin]::ShowWindow($h, 5) # SW_SHOW

$HWND_TOPMOST = [IntPtr](-1)
$HWND_NOTOPMOST = [IntPtr](-2)
$SWP_NOMOVE = 0x0002; $SWP_NOSIZE = 0x0001; $SWP_SHOWWINDOW = 0x0040

# 1) unlock foreground lock: simulate an Alt keypress
[DshWin]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero)
[DshWin]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)

# 2) raise in z-order (no foreground rights needed) -- fixes "covered by other windows"
[void][DshWin]::SetWindowPos($h, $HWND_TOPMOST, 0,0,0,0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW)

# 3) AttachThreadInput + BringWindowToTop + SetForegroundWindow
$fg = [DshWin]::GetForegroundWindow()
$fgPid = [uint32]0
$tFg = [DshWin]::GetWindowThreadProcessId($fg, [ref]$fgPid)
$myPid = [uint32]0
$tMe = [DshWin]::GetWindowThreadProcessId($h, [ref]$myPid)
[void][DshWin]::AttachThreadInput($tFg, $tMe, $true)
[void][DshWin]::BringWindowToTop($h)
[void][DshWin]::SetForegroundWindow($h)
[void][DshWin]::AttachThreadInput($tFg, $tMe, $false)

# 4) SwitchToThisWindow (Alt+Tab equivalent) to force foreground
[DshWin]::SwitchToThisWindow($h, $true)

# 5) leave topmost but stay at top of normal z-order
[void][DshWin]::SetWindowPos($h, $HWND_NOTOPMOST, 0,0,0,0, $SWP_NOMOVE -bor $SWP_NOSIZE -bor $SWP_SHOWWINDOW)

Start-Sleep -Milliseconds 200
$curFg = [DshWin]::GetForegroundWindow()
$curPid = [uint32]0
[void][DshWin]::GetWindowThreadProcessId($curFg, [ref]$curPid)
$ok = ($curPid -eq $target.Id)
if (-not $ok) {
  [DshWin]::SwitchToThisWindow($h, $true)
  Start-Sleep -Milliseconds 150
  $curFg = [DshWin]::GetForegroundWindow()
  [void][DshWin]::GetWindowThreadProcessId($curFg, [ref]$curPid)
  $ok = ($curPid -eq $target.Id)
}
Write-Output (@{ ok = [bool]$ok; pid = $target.Id; foregroundPid = [int]$curPid; folder = $Folder } | ConvertTo-Json -Compress)
