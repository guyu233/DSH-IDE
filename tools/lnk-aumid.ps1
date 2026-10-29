$sh = New-Object -ComObject Shell.Application
$paths = @()
$dirs = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:USERPROFILE\Desktop")
foreach($d in $dirs){
  if(Test-Path $d){
    Get-ChildItem $d -Recurse -Filter *.lnk -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '*DeepSeek*' } | ForEach-Object { $paths += $_.FullName }
  }
}
foreach($p in $paths){
  $folder = $sh.NameSpace((Split-Path $p))
  $item = $folder.ParseName((Split-Path $p -Leaf))
  if($item){ "$p  AUMID=" + $item.ExtendedProperty("System.AppUserModel.ID") }
}
if($paths.Count -eq 0){ "no DeepSeek .lnk found" }
