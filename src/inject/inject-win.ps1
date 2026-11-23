# Pointer/keyboard injector for argocast touchback (Windows).
# Reads commands from stdin, one per line; coordinates are 0..65535 over the
# whole virtual desktop (the area ffmpeg gdigrab "desktop" captures):
#   down X Y | move X Y | up X Y | rclick X Y | key VK
# Prints "size W H" (virtual desktop pixels) once at start-up.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class ArgoInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx, dy; public uint mouseData, dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort wVk, wScan; public uint dwFlags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit)] struct UNION { [FieldOffset(0)] public MOUSEINPUT mi; [FieldOffset(0)] public KEYBDINPUT ki; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public UNION u; }
  [DllImport("user32.dll")] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int i);
  const uint MOVE = 0x1, LDOWN = 0x2, LUP = 0x4, RDOWN = 0x8, RUP = 0x10, ABS = 0x8000, VDESK = 0x4000;
  static void Mouse(int x, int y, uint flags) {
    var i = new INPUT { type = 0 };
    i.u.mi = new MOUSEINPUT { dx = x, dy = y, dwFlags = flags | MOVE | ABS | VDESK };
    SendInput(1, new[] { i }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static void Down(int x, int y) { Mouse(x, y, LDOWN); }
  public static void Move(int x, int y) { Mouse(x, y, 0); }
  public static void Up(int x, int y) { Mouse(x, y, LUP); }
  public static void RightClick(int x, int y) { Mouse(x, y, RDOWN); Mouse(x, y, RUP); }
  public static void Key(ushort vk) {
    var d = new INPUT { type = 1 }; d.u.ki = new KEYBDINPUT { wVk = vk };
    var u = new INPUT { type = 1 }; u.u.ki = new KEYBDINPUT { wVk = vk, dwFlags = 2 };
    SendInput(2, new[] { d, u }, Marshal.SizeOf(typeof(INPUT)));
  }
  public static string Size() { return GetSystemMetrics(78) + " " + GetSystemMetrics(79); } // SM_CXVIRTUALSCREEN/CY
}
"@
[Console]::Out.WriteLine("size " + [ArgoInput]::Size())
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $p = $line.Split(' ')
  try {
    switch ($p[0]) {
      'down'   { [ArgoInput]::Down([int]$p[1], [int]$p[2]) }
      'move'   { [ArgoInput]::Move([int]$p[1], [int]$p[2]) }
      'up'     { [ArgoInput]::Up([int]$p[1], [int]$p[2]) }
      'rclick' { [ArgoInput]::RightClick([int]$p[1], [int]$p[2]) }
      'key'    { [ArgoInput]::Key([uint16]$p[1]) }
    }
  } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
