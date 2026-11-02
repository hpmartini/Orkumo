import React, { useState } from 'react';
import { Link2 } from 'lucide-react';
import { lastServerUrl, normalizeServerUrl, savePairing } from '../utils/remoteClient';

/** First start of the iOS app: connect to the DevOrbit server on the Mac (Issue #120). */
export const PairingScreen: React.FC<{ message?: string }> = ({ message }) => {
  const [url, setUrl] = useState(lastServerUrl);
  const [token, setToken] = useState('');
  const [error, setError] = useState(message ?? '');
  const [busy, setBusy] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const server = normalizeServerUrl(url);
    if (!server) return setError('Server-Adresse ungültig.');
    if (!token.trim()) return setError('Token fehlt.');
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`${server}/api/health`, {
        headers: { 'X-DevOrbit-Token': token.trim() },
      });
      if (response.status === 401) throw new Error('Token falsch.');
      if (!response.ok) throw new Error(`Server antwortet mit ${response.status}.`);
      savePairing({ url: server, token: token.trim() });
      window.location.reload();
    } catch (err) {
      setError(
        err instanceof Error && err.message !== 'Load failed'
          ? err.message
          : 'Server nicht erreichbar.'
      );
      setBusy(false);
    }
  };

  const input =
    'w-full rounded-lg bg-gray-800 border border-gray-700 px-3 py-3 text-base text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none';

  return (
    <main className="min-h-dvh bg-gray-950 text-gray-100 flex items-center justify-center px-4 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <form onSubmit={submit} className="w-full max-w-md space-y-4">
        <div className="flex items-center gap-2">
          <Link2 className="h-6 w-6 text-blue-400" aria-hidden />
          <h1 className="text-xl font-semibold">Mit DevOrbit verbinden</h1>
        </div>
        <p className="text-sm text-gray-400">
          Adresse und Token stehen auf dem Mac unter Admin Panel → iOS-App. Oder den Pairing-Link
          von dort auf diesem Gerät öffnen.
        </p>
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Server-Adresse</span>
          <input
            className={input}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mein-mac.tailnet.ts.net"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-gray-300">Pairing-Token</span>
          <input
            className={input}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoCapitalize="none"
            autoCorrect="off"
            type="password"
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-red-400">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-blue-600 py-3 text-base font-medium text-white disabled:opacity-50"
        >
          {busy ? 'Verbinde …' : 'Verbinden'}
        </button>
      </form>
    </main>
  );
};
