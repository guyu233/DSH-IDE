$exe = 'E:\vscode-dsh\dsh-ide\DeepSeek Harness.exe'
$wd  = 'E:\vscode-dsh'
$args = 'E:\vscode-dsh --user-data-dir=E:\vscode-dsh\.dsh-ide-data --extensions-dir=E:\vscode-dsh\.dsh-ide-ext'
$cmd = '"' + $exe + '" ' + $args
$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $cmd; CurrentDirectory = $wd }
"ReturnValue=$($r.ReturnValue) ProcessId=$($r.ProcessId)"
