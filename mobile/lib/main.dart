import 'dart:async';
import 'dart:io' show Platform;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import 'caster.dart';
import 'native.dart';
import 'protocol/sharecode.dart';
import 'settings.dart';

const _accent = Color(0xFF14B8A6);

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  final settings = await Settings.load();
  runApp(ArgocastApp(settings: settings, caster: Caster(settings)));
}

class ArgocastApp extends StatelessWidget {
  const ArgocastApp({super.key, required this.settings, required this.caster});
  final Settings settings;
  final Caster caster;

  ThemeData _theme(Brightness b) => ThemeData(
        useMaterial3: true,
        colorScheme: ColorScheme.fromSeed(seedColor: _accent, brightness: b, primary: _accent),
        inputDecorationTheme: const InputDecorationTheme(border: OutlineInputBorder(), isDense: true),
      );

  @override
  Widget build(BuildContext context) => MaterialApp(
        title: 'argocast',
        debugShowCheckedModeBanner: false,
        theme: _theme(Brightness.light),
        darkTheme: _theme(Brightness.dark),
        home: HomePage(settings: settings, caster: caster),
      );
}

class HomePage extends StatefulWidget {
  const HomePage({super.key, required this.settings, required this.caster});
  final Settings settings;
  final Caster caster;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  List<Panel> _panels = const [];
  bool _scanning = false;
  final _host = TextEditingController();
  final _pin = TextEditingController();
  String? _lastError;

  Caster get caster => widget.caster;

  @override
  void initState() {
    super.initState();
    caster.addListener(_onCaster);
    _scan();
  }

  @override
  void dispose() {
    caster.removeListener(_onCaster);
    super.dispose();
  }

  void _onCaster() {
    final err = caster.error;
    if (err != null && err != _lastError && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text(err), backgroundColor: Theme.of(context).colorScheme.error),
      );
    }
    _lastError = err;
    setState(() {});
  }

  Future<void> _scan() async {
    setState(() => _scanning = true);
    try {
      final found = await NativeBridge.discover();
      if (mounted) setState(() => _panels = found);
    } on PlatformException catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Pencarian gagal: ${e.message}')));
    } finally {
      if (mounted) setState(() => _scanning = false);
    }
  }

  Future<void> _askPin(Panel p) async {
    final ctrl = TextEditingController();
    final pin = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Masukkan PIN'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text('${p.name} — ${p.host}:${p.port}', style: Theme.of(ctx).textTheme.bodySmall),
          const SizedBox(height: 12),
          TextField(
            controller: ctrl,
            autofocus: true,
            keyboardType: TextInputType.number,
            textAlign: TextAlign.center,
            maxLength: 8,
            style: const TextStyle(fontSize: 26, letterSpacing: 8),
            decoration: const InputDecoration(hintText: '••••', counterText: ''),
            onSubmitted: (v) => Navigator.pop(ctx, v),
          ),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Batal')),
          FilledButton(onPressed: () => Navigator.pop(ctx, ctrl.text), child: const Text('Hubungkan')),
        ],
      ),
    );
    if (pin != null) caster.start(p, pin.trim());
  }

  bool get _typedIp => isIPv4(_host.text.trim().split(':').first);

  /// Code ("834 109"), IP[:port] (+ PIN field) or a scanned link.
  void _connectManual() {
    final text = _host.text.trim();
    if (text.isEmpty) return;
    FocusScope.of(context).unfocus();
    caster.startWithCode(text, pin: _typedIp ? _pin.text.trim() : '');
  }

  Future<void> _scanQr() async {
    final value = await Navigator.of(context).push<String>(MaterialPageRoute(builder: (_) => const ScanPage()));
    if (value != null && mounted) caster.startWithCode(value);
  }

  @override
  Widget build(BuildContext context) {
    final body = switch (caster.state) {
      CastState.idle => _home(),
      CastState.casting => CastingView(caster: caster),
      _ => ConnectingView(caster: caster),
    };
    return PopScope(
      canPop: !caster.busy,
      child: Scaffold(
        appBar: AppBar(
          title: const _Wordmark(),
          actions: [
            IconButton(
              icon: const Icon(Icons.settings_outlined),
              tooltip: 'Pengaturan',
              onPressed: caster.busy ? null : () => showSettings(context, widget.settings),
            ),
          ],
        ),
        body: SafeArea(child: AnimatedSwitcher(duration: const Duration(milliseconds: 200), child: body)),
      ),
    );
  }

  Widget _home() {
    final recent = widget.settings.recent;
    return RefreshIndicator(
      key: const ValueKey('home'),
      onRefresh: _scan,
      child: ListView(padding: const EdgeInsets.all(16), children: [
        _Section(
          title: 'Panel di jaringan',
          trailing: _scanning
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : TextButton(onPressed: _scan, child: const Text('Cari ulang')),
          children: [
            if (_panels.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Text(
                  _scanning ? 'Mencari panel…' : 'Tidak ada panel ditemukan. Gunakan sambung manual di bawah.',
                  style: TextStyle(color: Theme.of(context).colorScheme.onSurfaceVariant),
                ),
              ),
            for (final p in _panels) _PanelTile(panel: p, onTap: () => _askPin(p)),
          ],
        ),
        if (recent.isNotEmpty)
          _Section(title: 'Terakhir dipakai', children: [for (final p in recent) _PanelTile(panel: p, onTap: () => _askPin(p))]),
        _Section(title: 'Sambung dengan kode', children: [
          TextField(
            controller: _host,
            keyboardType: TextInputType.visiblePassword, // digits + letters + dots, no autocorrect
            style: const TextStyle(fontSize: 20, letterSpacing: 3, fontFamily: 'monospace'),
            onChanged: (_) => setState(() {}),
            onSubmitted: (_) => _connectManual(),
            decoration: InputDecoration(
              labelText: 'Kode di layar panel',
              hintText: '834 109',
              suffixIcon: IconButton(
                icon: const Icon(Icons.qr_code_scanner),
                tooltip: 'Scan QR di layar panel',
                onPressed: _scanQr,
              ),
            ),
          ),
          if (_typedIp) ...[
            const SizedBox(height: 12),
            TextField(
              controller: _pin,
              keyboardType: TextInputType.number,
              decoration: const InputDecoration(labelText: 'PIN', hintText: 'Kode PIN di layar panel'),
              onSubmitted: (_) => _connectManual(),
            ),
          ],
          const SizedBox(height: 12),
          FilledButton(onPressed: _connectManual, child: const Text('Hubungkan')),
          const SizedBox(height: 8),
          OutlinedButton.icon(onPressed: _scanQr, icon: const Icon(Icons.qr_code_scanner), label: const Text('Scan QR di layar panel')),
          const SizedBox(height: 8),
          Text('Ketik kode yang tampil di layar panel, atau scan QR-nya. Bisa juga alamat IP panel. '
              'Ponsel dan panel harus berada di jaringan Wi-Fi yang sama.',
              style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Theme.of(context).colorScheme.onSurfaceVariant)),
        ]),
      ]),
    );
  }
}

/// Full-screen camera that returns the first QR / barcode value.
class ScanPage extends StatefulWidget {
  const ScanPage({super.key});
  @override
  State<ScanPage> createState() => _ScanPageState();
}

class _ScanPageState extends State<ScanPage> {
  bool _done = false;

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Scan QR di layar panel')),
        body: Stack(children: [
          MobileScanner(
            onDetect: (capture) {
              final value = capture.barcodes.map((b) => b.rawValue).whereType<String>().firstOrNull;
              if (value == null || _done) return;
              _done = true;
              Navigator.of(context).pop(value);
            },
            errorBuilder: (context, error) => Center(
              child: Padding(
                padding: const EdgeInsets.all(24),
                child: Text('Kamera tidak bisa dibuka (${error.errorCode.name}). Izinkan akses kamera untuk argocast.',
                    textAlign: TextAlign.center),
              ),
            ),
          ),
          Center(
            child: Container(
              width: 240,
              height: 240,
              decoration: BoxDecoration(border: Border.all(color: _accent, width: 3), borderRadius: BorderRadius.circular(16)),
            ),
          ),
          const Align(
            alignment: Alignment(0, .8),
            child: Text('Arahkan kamera ke QR code di layar panel',
                style: TextStyle(color: Colors.white, shadows: [Shadow(blurRadius: 6)])),
          ),
        ]),
      );
}

class _Wordmark extends StatelessWidget {
  const _Wordmark();
  @override
  Widget build(BuildContext context) => Row(mainAxisSize: MainAxisSize.min, children: [
        Container(
          width: 28,
          height: 28,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(8),
            gradient: const LinearGradient(colors: [_accent, Color(0xFF6366F1)]),
          ),
          child: const Icon(Icons.cast, size: 16, color: Colors.white),
        ),
        const SizedBox(width: 10),
        Text.rich(TextSpan(children: [
          const TextSpan(text: 'argo'),
          TextSpan(text: 'cast', style: TextStyle(color: _accent, fontWeight: FontWeight.w700)),
        ])),
      ]);
}

class _Section extends StatelessWidget {
  const _Section({required this.title, required this.children, this.trailing});
  final String title;
  final List<Widget> children;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) => Card(
        margin: const EdgeInsets.only(bottom: 12),
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Row(children: [
              Expanded(
                child: Text(title.toUpperCase(),
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                        letterSpacing: .6, color: Theme.of(context).colorScheme.onSurfaceVariant)),
              ),
              ?trailing,
            ]),
            const SizedBox(height: 8),
            ...children,
          ]),
        ),
      );
}

class _PanelTile extends StatelessWidget {
  const _PanelTile({required this.panel, required this.onTap});
  final Panel panel;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) => ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 8),
        leading: const Icon(Icons.tv, color: _accent, size: 32),
        title: Text(panel.name, maxLines: 1, overflow: TextOverflow.ellipsis),
        subtitle: Text('${panel.host}:${panel.port}', style: const TextStyle(fontFamily: 'monospace')),
        trailing: const Icon(Icons.chevron_right),
        onTap: onTap,
      );
}

class ConnectingView extends StatelessWidget {
  const ConnectingView({super.key, required this.caster});
  final Caster caster;

  static final _steps = [
    Platform.isIOS
        ? (CastState.waitingForUser, 'Ketuk "Start Broadcast"')
        : (CastState.preparing, 'Izin merekam layar'),
    (CastState.connecting, 'Menghubungi panel'),
    (CastState.authenticating, 'Memeriksa PIN'),
    (CastState.starting, 'Menyiapkan siaran'),
  ];

  @override
  Widget build(BuildContext context) {
    final current = caster.state == CastState.preparing ? 0 : _steps.indexWhere((s) => s.$1 == caster.state);
    final waiting = caster.state == CastState.waitingForUser;
    return Center(
      key: const ValueKey('connecting'),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const SizedBox(width: 64, height: 64, child: CircularProgressIndicator(strokeWidth: 5)),
          const SizedBox(height: 20),
          Text('Menghubungkan ke ${caster.target?.name ?? ''}…', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 16),
          for (var i = 0; i < _steps.length; i++)
            ListTile(
              dense: true,
              leading: i < current
                  ? const Icon(Icons.check_circle, color: _accent)
                  : i == current
                      ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2))
                      : const Icon(Icons.radio_button_unchecked),
              title: Text(_steps[i].$2),
            ),
          if (waiting) ...[
            const SizedBox(height: 8),
            Text(
              'Di lembar "Screen Broadcast", pastikan argocast terpilih lalu ketuk Start Broadcast.',
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 8),
            FilledButton.icon(
              onPressed: caster.reopenPicker,
              icon: const Icon(Icons.screen_share_outlined),
              label: const Text('Buka lembar siaran'),
            ),
          ],
          const SizedBox(height: 12),
          OutlinedButton(onPressed: caster.stop, child: const Text('Batal')),
        ]),
      ),
    );
  }
}

class CastingView extends StatefulWidget {
  const CastingView({super.key, required this.caster});
  final Caster caster;
  @override
  State<CastingView> createState() => _CastingViewState();
}

class _CastingViewState extends State<CastingView> {
  late final Timer _tick = Timer.periodic(const Duration(seconds: 1), (_) {
    widget.caster.refreshTouchback(); // picks up the accessibility switch when the user comes back
    setState(() {});
  });

  @override
  void dispose() {
    _tick.cancel();
    super.dispose();
  }

  String _elapsed() {
    final d = DateTime.now().difference(widget.caster.startedAt ?? DateTime.now());
    String two(int n) => n.toString().padLeft(2, '0');
    final h = d.inHours;
    return h > 0 ? '$h:${two(d.inMinutes % 60)}:${two(d.inSeconds % 60)}' : '${two(d.inMinutes)}:${two(d.inSeconds % 60)}';
  }

  @override
  Widget build(BuildContext context) {
    final c = widget.caster;
    final scheme = Theme.of(context).colorScheme;
    Widget stat(String label, String value) => Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 10),
              child: Column(children: [
                Text(label, style: Theme.of(context).textTheme.labelSmall),
                const SizedBox(height: 2),
                Text(value, style: const TextStyle(fontFamily: 'monospace', fontWeight: FontWeight.w600)),
              ]),
            ),
          ),
        );
    return Center(
      key: const ValueKey('casting'),
      child: SingleChildScrollView(
        padding: const EdgeInsets.all(24),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(color: scheme.error.withValues(alpha: .12), borderRadius: BorderRadius.circular(99)),
            child: Text('● LIVE', style: TextStyle(color: scheme.error, fontWeight: FontWeight.w700, letterSpacing: 1.5)),
          ),
          const SizedBox(height: 20),
          const Icon(Icons.cast_connected, size: 96, color: _accent),
          const SizedBox(height: 12),
          Text('Sedang cast ke', style: Theme.of(context).textTheme.titleMedium),
          Text(c.target?.name ?? '', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600)),
          const SizedBox(height: 6),
          Text(_elapsed(), style: const TextStyle(fontFamily: 'monospace', fontSize: 30, color: _accent)),
          const SizedBox(height: 12),
          Row(children: [
            stat('FPS', '${c.stats.fps}'),
            stat('BITRATE', '${c.stats.kbps} kbps'),
            stat('RESOLUSI', c.capture == null ? '—' : '${c.capture!.width}×${c.capture!.height}'),
          ]),
          if (Platform.isAndroid && c.settings.touchback && c.touchbackConnected) ...[
            const SizedBox(height: 8),
            if (c.touchbackReady)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                decoration: BoxDecoration(color: _accent.withValues(alpha: .14), borderRadius: BorderRadius.circular(99)),
                child: const Text('TOUCHBACK ACTIVE',
                    style: TextStyle(color: _accent, fontWeight: FontWeight.w700, letterSpacing: 1.2, fontSize: 12)),
              )
            else
              Card(
                child: ListTile(
                  leading: const Icon(Icons.touch_app_outlined),
                  title: const Text('Kendalikan ponsel dari panel'),
                  subtitle: const Text('Aktifkan "argocast touchback" di pengaturan Aksesibilitas.'),
                  trailing: TextButton(onPressed: NativeBridge.openAccessibilitySettings, child: const Text('Aktifkan')),
                ),
              ),
          ],
          const SizedBox(height: 16),
          FilledButton.icon(
            style: FilledButton.styleFrom(backgroundColor: scheme.error, minimumSize: const Size(220, 48)),
            onPressed: c.stop,
            icon: const Icon(Icons.stop_circle_outlined),
            label: const Text('Hentikan cast'),
          ),
          const SizedBox(height: 10),
          Text(
              Platform.isIOS
                  ? 'Cast tetap berjalan saat Anda membuka aplikasi lain. Hentikan dari sini, dari indikator merah di status bar, atau Control Center.'
                  : 'Cast tetap berjalan saat aplikasi diminimalkan. Hentikan dari sini atau dari notifikasi.',
              textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
        ]),
      ),
    );
  }
}

Future<void> showSettings(BuildContext context, Settings s) {
  final name = TextEditingController(text: s.deviceName);
  var maxSize = s.maxSize, fps = s.fps, quality = s.quality, touchback = s.touchback;
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (ctx) => StatefulBuilder(
      builder: (ctx, setLocal) => Padding(
        padding: EdgeInsets.fromLTRB(20, 0, 20, 20 + MediaQuery.of(ctx).viewInsets.bottom),
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Pengaturan', style: Theme.of(ctx).textTheme.titleLarge),
          const SizedBox(height: 16),
          TextField(controller: name, decoration: const InputDecoration(labelText: 'Nama perangkat')),
          const SizedBox(height: 16),
          DropdownButtonFormField<int>(
            initialValue: maxSize,
            decoration: const InputDecoration(labelText: 'Resolusi'),
            items: const [
              DropdownMenuItem(value: 1920, child: Text('Full HD (1920)')),
              DropdownMenuItem(value: 1280, child: Text('HD (1280)')),
            ],
            onChanged: (v) => setLocal(() => maxSize = v ?? maxSize),
          ),
          const SizedBox(height: 16),
          DropdownButtonFormField<int>(
            initialValue: fps,
            decoration: const InputDecoration(labelText: 'Frame rate'),
            items: const [
              DropdownMenuItem(value: 30, child: Text('30 fps')),
              DropdownMenuItem(value: 24, child: Text('24 fps')),
              DropdownMenuItem(value: 15, child: Text('15 fps')),
            ],
            onChanged: (v) => setLocal(() => fps = v ?? fps),
          ),
          const SizedBox(height: 16),
          Text('Kualitas', style: Theme.of(ctx).textTheme.labelLarge),
          const SizedBox(height: 6),
          SegmentedButton<Quality>(
            segments: [for (final q in Quality.values) ButtonSegment(value: q, label: Text(qualityLabel[q]!))],
            selected: {quality},
            onSelectionChanged: (v) => setLocal(() => quality = v.first),
          ),
          if (Platform.isAndroid) ...[
            const SizedBox(height: 8),
            SwitchListTile(
              contentPadding: EdgeInsets.zero,
              title: const Text('Touchback'),
              subtitle: const Text('Sentuhan di panel mengendalikan ponsel (perlu izin Aksesibilitas).'),
              value: touchback,
              onChanged: (v) => setLocal(() => touchback = v),
            ),
          ],
          const SizedBox(height: 20),
          FilledButton(
            onPressed: () async {
              await s.update(deviceName: name.text, maxSize: maxSize, fps: fps, quality: quality, touchback: touchback);
              if (ctx.mounted) Navigator.pop(ctx);
            },
            child: const Text('Simpan'),
          ),
        ]),
      ),
    ),
  );
}
