// Pointer/keyboard injector for argocast touchback (macOS, JavaScript for Automation).
// Run with: osascript -l JavaScript inject-mac.js
// Needs Accessibility permission for argocast (System Settings › Privacy & Security › Accessibility).
// stdin lines: down X Y | move X Y | up X Y | rclick X Y | key MACKEYCODE   (X,Y 0..65535 over the main display)
ObjC.import('Cocoa');
ObjC.import('CoreGraphics');

function run() {
  const bounds = $.CGDisplayBounds($.CGMainDisplayID());
  const W = bounds.size.width, H = bounds.size.height;
  const out = $.NSFileHandle.fileHandleWithStandardOutput;
  out.writeData($(`size ${W} ${H}\n`).dataUsingEncoding($.NSUTF8StringEncoding));

  const post = (type, x, y, button) => {
    const p = $.CGPointMake((x / 65535) * W, (y / 65535) * H);
    const e = $.CGEventCreateMouseEvent(null, type, p, button);
    $.CGEventPost($.kCGHIDEventTap, e);
  };
  const L = $.kCGMouseButtonLeft, R = $.kCGMouseButtonRight;
  const input = $.NSFileHandle.fileHandleWithStandardInput;
  let pending = '';
  for (;;) {
    const data = input.availableData;
    if (data.length === 0) break; // EOF
    pending += $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
    let nl;
    while ((nl = pending.indexOf('\n')) >= 0) {
      const [cmd, a, b] = pending.slice(0, nl).trim().split(' ');
      pending = pending.slice(nl + 1);
      const x = Number(a), y = Number(b);
      if (cmd === 'down') post($.kCGEventLeftMouseDown, x, y, L);
      else if (cmd === 'move') post($.kCGEventLeftMouseDragged, x, y, L);
      else if (cmd === 'up') post($.kCGEventLeftMouseUp, x, y, L);
      else if (cmd === 'rclick') { post($.kCGEventRightMouseDown, x, y, R); post($.kCGEventRightMouseUp, x, y, R); }
      else if (cmd === 'key') {
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateKeyboardEvent(null, x, true));
        $.CGEventPost($.kCGHIDEventTap, $.CGEventCreateKeyboardEvent(null, x, false));
      }
    }
  }
}
