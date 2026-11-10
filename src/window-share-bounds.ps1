$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CloudMeetSharedWindow {
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int a, out Rect r, int size);
}
'@
[void][CloudMeetSharedWindow]::SetThreadDpiAwarenessContext([IntPtr](-4))
$sharedWindowHandle = [IntPtr]([long]__WINDOW_HANDLE__)
while ($true) {
  $valid = [CloudMeetSharedWindow]::IsWindow($sharedWindowHandle)
  $visible = $valid -and [CloudMeetSharedWindow]::IsWindowVisible($sharedWindowHandle) -and -not [CloudMeetSharedWindow]::IsIconic($sharedWindowHandle)
  $rect = New-Object CloudMeetSharedWindow+Rect
  if ($visible) {
    $result = [CloudMeetSharedWindow]::DwmGetWindowAttribute($sharedWindowHandle, 9, [ref]$rect, 16)
    if ($result -ne 0) { $visible = [CloudMeetSharedWindow]::GetWindowRect($sharedWindowHandle, [ref]$rect) }
  }
  @{ valid=$valid; visible=$visible; x=$rect.Left; y=$rect.Top; width=($rect.Right-$rect.Left); height=($rect.Bottom-$rect.Top) } | ConvertTo-Json -Compress
  if (-not $valid) { break }
  Start-Sleep -Milliseconds 200
}
