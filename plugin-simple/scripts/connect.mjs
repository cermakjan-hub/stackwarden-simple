// @ts-check
// Connects this computer to one Stackwarden organization, the way a CLI signs in to its service:
// the person approves it in their browser, signed in to Stackwarden, and the browser hands a
// one-time grant back to a listener on 127.0.0.1, which only this computer can reach.
// The key is made here and never leaves the computer but in requests to Stackwarden; Stackwarden
// stores only its hash. The listener runs in the background for at most twelve minutes, answers
// only that one address, and stops after one grant. The browser opens only at that Stackwarden.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { hostname } from 'node:os';
import { join } from 'node:path';

import { config, readJson, rmQuietly, saveConfig, updatePanelFile, writeJson } from './local.mjs';
import { pairingStatus, redeemGrant, revokeKey, sha256, startPairing } from './stackwarden.mjs';

const PENDING = 'reader-pairing.json';
const FAILED = 'reader-pairing-error.json';
const GRACE_MS = 2 * 60_000;

const token = (/** @type {number} */ bytes) => randomBytes(bytes).toString('base64url');

/** This computer's name, as the person sees it under API keys. */
export function machineName() {
  const name = hostname()
    .replace(/[^\p{L}\p{N} ._'()-]/gu, '')
    .trim()
    .slice(0, 60);
  return name || 'this computer';
}

/** The page the browser shows after Connect. @param {string} title @param {string} text */
const page = (title, text) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head>` +
  `<body style="font:16px system-ui;margin:3rem auto;max-width:32rem"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></body></html>`;

/**
 * The listener, started in the background by `connect`. It starts the pairing, so its address is
 * known, saves what `connect` shows the person, then waits for the grant and saves the key.
 * @param {string} folder @param {string} base @param {string} nonce
 */
export async function listen(folder, base, nonce) {
  const key = `swk_${token(32)}`;
  const secret = token(32);
  const verifier = token(32);
  const path = `/${token(24)}`;
  const server = createServer();
  await new Promise((done) => server.listen(0, '127.0.0.1', () => done(undefined)));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  let started;
  try {
    started = await startPairing(base, {
      secret_hash: sha256(secret),
      key_hashes: [sha256(key)],
      machine: machineName(),
      code_challenge: createHash('sha256').update(verifier, 'ascii').digest('base64url'),
      code_challenge_method: 'S256',
      redirect_uri: `http://127.0.0.1:${String(port)}${path}`,
    });
  } catch (error) {
    writeJson(join(folder, FAILED), { nonce, message: error instanceof Error ? error.message : 'Connecting failed.' });
    server.close();
    return;
  }
  if (new URL(started.approve_url).origin !== new URL(base).origin) {
    server.close();
    return;
  }
  // Corrected by the gap between Stackwarden's clock and this computer's.
  const skew = started.date ? Date.parse(started.date) - Date.now() : 0;
  const expiresAt = Date.parse(started.expires_at) - (Number.isFinite(skew) ? skew : 0);
  writeJson(join(folder, PENDING), {
    nonce,
    id: started.id,
    secret,
    approveUrl: started.approve_url,
    startedAt: Date.now(),
    expiresAt,
    // So that cancelling stops this listener, and a Connect clicked later finishes nothing.
    pid: process.pid,
  });
  let taken = false;
  const stop = setTimeout(() => server.close(), Math.max(0, expiresAt + GRACE_MS - Date.now()));
  server.on('request', (request, response) => {
    const url = new URL(request.url ?? '/', `http://127.0.0.1:${String(port)}`);
    const grant = url.searchParams.get('grant') ?? '';
    if (
      request.method !== 'GET' ||
      request.headers.host !== `127.0.0.1:${String(port)}` ||
      url.pathname !== path ||
      !/^[A-Za-z0-9_-]{43}$/.test(grant)
    ) {
      response.writeHead(404).end();
      return;
    }
    if (taken) {
      response.writeHead(409).end();
      return;
    }
    taken = true;
    void redeemGrant(base, started.id, secret, { grant, code_verifier: verifier }).then(async (redeemed) => {
      const organization = redeemed?.organizations?.find((/** @type {any} */ each) => each.key === 0);
      if (organization) await keep(folder, base, { id: organization.id, name: organization.name ?? null, key });
      else writeJson(join(folder, FAILED), { nonce, message: "Stackwarden didn't accept the approval." });
      response
        .writeHead(organization ? 200 : 400, {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
          'referrer-policy': 'no-referrer',
        })
        .end(
          organization
            ? page(
                'This computer is connected to Stackwarden.',
                'You can close this tab. Claude Code goes on by itself.',
              )
            : page("Connecting didn't finish.", "Stackwarden didn't accept it. Start again from Claude Code."),
          () => {
            clearTimeout(stop);
            server.close();
          },
        );
    });
  });
}

/**
 * Keeps the new key as this computer's only organization, and revokes the keys it replaces. Another
 * organization than before, as after "Switch account", starts as a first connection: the yes to send,
 * what was filed and what the panel showed were the last one's, so the person is asked again.
 * @param {string} folder @param {string} base @param {{ id: string, name: string | null, key: string }} organization
 */
async function keep(folder, base, organization) {
  const before = config(folder);
  const sameOrganization = before?.organizations[0]?.id === organization.id;
  saveConfig(folder, {
    version: 2,
    url: base,
    organizations: [{ ...organization, pairedAt: new Date().toISOString() }],
    accounts: sameOrganization ? before.accounts : {},
  });
  if (before?.organizations[0] && !sameOrganization) {
    rmQuietly(join(folder, 'reader-state.json'));
    updatePanelFile(folder, (file) => ({ ...file, view: null, repos: {}, rounds: {} }));
  }
  for (const old of before?.organizations ?? []) {
    if (old.key !== organization.key) await revokeKey(before?.url ?? base, old.key);
  }
}

/**
 * Starts the listener in the background and waits until it has the approval page's address.
 * @param {string} folder @param {string} self @param {string} base
 * @returns {Promise<{ url: string } | { error: string }>}
 */
export async function connect(folder, self, base) {
  rmQuietly(join(folder, PENDING));
  rmQuietly(join(folder, FAILED));
  const nonce = token(16);
  spawn(process.execPath, [self, 'pair', 'listen', '--nonce', nonce, '--data', folder], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    cwd: folder,
  }).unref();
  for (let waited = 0; waited < 15_000; waited += 250) {
    await new Promise((done) => setTimeout(done, 250));
    const pending = readJson(join(folder, PENDING));
    if (pending?.nonce === nonce) return { url: String(pending.approveUrl) };
    const failed = readJson(join(folder, FAILED));
    if (failed?.nonce === nonce) return { error: String(failed.message) };
  }
  return { error: "Connecting didn't start. Try again." };
}

/**
 * Stops connecting, as the panel's Cancel does: the listener stops, so a Connect clicked later on the
 * page finishes nothing, and the wait ends. This computer stays as it was. Whether anything was
 * waiting. Only a listener this folder started within its life is stopped, by the process it named.
 * @param {string} folder
 * @returns {boolean}
 */
export function cancelConnecting(folder) {
  const pending = readJson(join(folder, PENDING));
  rmQuietly(join(folder, PENDING));
  rmQuietly(join(folder, FAILED));
  if (!pending) return false;
  const pid = Number(pending.pid);
  const young =
    Date.now() - Number(pending.startedAt) < Number(pending.expiresAt) - Number(pending.startedAt) + GRACE_MS;
  if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && young) {
    try {
      process.kill(pid);
    } catch {
      // It had stopped already.
    }
  }
  return true;
}

/** Opens the person's browser at a page of the Stackwarden this computer connects to, and nothing else. @param {string} url @param {string} base */
export function openBrowser(url, base) {
  if (new URL(url).origin !== new URL(base).origin || !/^[A-Za-z0-9:/?=._~%-]+$/.test(url)) return;
  const [file, args] =
    process.platform === 'win32'
      ? ['cmd.exe', ['/d', '/s', '/c', 'start', '""', `"${url}"`]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];
  const child = spawn(file, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    shell: false,
    windowsVerbatimArguments: process.platform === 'win32',
  });
  child.on('error', () => undefined);
  child.unref();
}

/**
 * Waits for the person's approval, for up to `seconds`: the listener saves the key when they click
 * Connect. Stackwarden is asked only whether they denied it or let it expire.
 * @param {string} folder @param {string} base @param {number} seconds
 * @returns {Promise<'approved' | 'waiting' | 'denied' | 'expired' | 'failed' | 'cancelled'>}
 */
export async function waitForApproval(folder, base, seconds) {
  const pending = readJson(join(folder, PENDING));
  if (!pending?.id) return config(folder)?.organizations[0] ? 'approved' : 'expired';
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const kept = config(folder);
    if (kept?.organizations[0] && Date.parse(kept.organizations[0].pairedAt) >= pending.startedAt) {
      rmQuietly(join(folder, PENDING));
      return 'approved';
    }
    // The person cancelled it from the panel, or started connecting again.
    if (readJson(join(folder, PENDING))?.nonce !== pending.nonce) return 'cancelled';
    if (readJson(join(folder, FAILED))?.nonce === pending.nonce) return 'failed';
    const status = await pairingStatus(base, pending.id, pending.secret);
    if (status === 'denied' || (status === 'expired' && Date.now() > pending.expiresAt + GRACE_MS)) {
      rmQuietly(join(folder, PENDING));
      return status;
    }
    await new Promise((done) => setTimeout(done, 3000));
  }
  return 'waiting';
}
