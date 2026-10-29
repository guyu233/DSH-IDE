Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @'
using System;using System.Runtime.InteropServices;
public class TB{[DllImport("user32.dll",CharSet=CharSet.Unicode)]public static extern IntPtr FindWindow(string c,string n);}
'@
$tray = [TB]::FindWindow("Shell_TrayWnd", $null)
$root = [System.Windows.Automation.AutomationElement]::FromHandle($tray)
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
$buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)
"button count: " + $buttons.Count
$i=0
foreach($b in $buttons){
  $i++
  $name = $b.Current.Name
  if($name -ne ""){ "[$i] $name" }
}
