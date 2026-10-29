@echo off
REM ============================================================
REM  DSH (DeepSeek Harness) 一键重置 / 恢复
REM  用途：当 DSH Host 内存升高、新建会话变慢/超时（"Host 疲劳"）时，
REM        双击本脚本即可完全重启 DSH，回到干净基线。
REM  注意：会关闭当前 DSH 窗口与本对话的 agent 会话；重启后重新打开即可。
REM ============================================================
setlocal
echo [DSH] 正在关闭现有 DSH 进程...
taskkill /IM "DeepSeek Harness.exe" /F >nul 2>&1
timeout /t 2 /nobreak >nul

echo [DSH] 正在重新启动 DSH...
set "DSH_EXE=%LOCALAPPDATA%\Programs\DeepSeek Harness\DeepSeek Harness.exe"
if not exist "%DSH_EXE%" (
  echo [DSH] 未在默认路径找到 DSH：%DSH_EXE%
  echo [DSH] 请手动启动 DeepSeek Harness。
  pause
  exit /b 1
)
start "" "%DSH_EXE%"
echo [DSH] 已启动。请稍候，待 DSH 窗口出现后重新打开 DSH-IDE 即可。
timeout /t 3 /nobreak >nul
endlocal
