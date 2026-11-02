import { useEffect, useState } from 'react';
import { Copy, Smartphone } from 'lucide-react';
import QRCode from 'qrcode';
import { API_BASE_URL, isNativeApp } from '../utils/apiConfig';

interface PairingInfo {
  enabled: boolean;
  url?: string | null;
  token?: string;
  link?: string | null;
}

/** Admin panel: what the iOS app needs to pair with this Mac (Issue #120). Local only. */
export function RemotePairingSection() {
  const [info, setInfo] = useState<PairingInfo | null>(null);
  const [qr, setQr] = useState('');

  useEffect(() => {
    if (isNativeApp) return;
    fetch(`${API_BASE_URL}/remote/pairing`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  // The iPhone camera opens devorbit:// links from a QR code straight in the app.
  useEffect(() => {
    if (!info?.link) return;
    QRCode.toDataURL(info.link, { margin: 1, width: 200 })
      .then(setQr)
      .catch(() => setQr(''));
  }, [info?.link]);

  if (!info) return null;

  const row = (label: string, value: string) => (
    <div className="flex items-center gap-2">
      <span className="w-20 shrink-0 text-xs text-gray-400">{label}</span>
      <code className="flex-1 truncate rounded bg-gray-800 px-2 py-1 text-xs text-gray-200">
        {value}
      </code>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="p-1.5 rounded hover:bg-gray-700 transition-colors"
        aria-label={`${label} kopieren`}
      >
        <Copy size={14} className="text-gray-400" />
      </button>
    </div>
  );

  return (
    <div className="pt-4 border-t border-gray-700">
      <div className="flex items-center gap-2 mb-4">
        <Smartphone className="text-sky-400" size={18} />
        <label className="text-sm font-medium text-gray-300">iOS-App</label>
      </div>
      <div className="p-4 bg-gray-900 rounded-lg border border-gray-700 space-y-2">
        {info.enabled ? (
          <>
            {row('Adresse', info.url ?? 'Tailscale nicht gefunden: DEVORBIT_REMOTE_URL setzen')}
            {info.token && row('Token', info.token)}
            {info.link && row('Link', info.link)}
            {qr && (
              <img
                src={qr}
                alt="Pairing-QR-Code für die iOS-App"
                className="mx-auto h-40 w-40 rounded bg-white p-1"
              />
            )}
            <p className="text-xs text-gray-500">
              QR-Code mit der iPhone/iPad-Kamera scannen, den Link öffnen (AirDrop, Notiz) oder
              Adresse und Token in der App eingeben.
            </p>
          </>
        ) : (
          <p className="text-xs text-gray-400">
            Remote-Zugang ist aus. Server mit <code>DEVORBIT_REMOTE=true</code> starten und{' '}
            <code>tailscale serve</code> einrichten (siehe README, Abschnitt iOS).
          </p>
        )}
      </div>
    </div>
  );
}
