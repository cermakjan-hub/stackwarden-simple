// @ts-check
// The one place anything leaves this computer: every request to Stackwarden, and every field it
// sends. Nothing goes anywhere else.
//
//   POST /api/reader/pairings              connecting: hashes of a new key and a secret, this
//                                          computer's name, a PKCE challenge, the 127.0.0.1 address
//   POST /api/reader/pairings/{id}/redeem  the one-time grant the browser passed back, the PKCE verifier
//   GET  /api/reader/pairings/{id}         whether the person approved, denied or let it expire
//   DELETE /api/reader/key                 revoking this computer's earlier key
//   POST /api/ingest/cli-reading           a CLI's answers to the read commands its recipe lists, with
//                                          only the fields the recipe keeps (see connectors/*.json)
//   POST /api/ingest/scan                  the repo's name, Git address, commit, and each service found
//                                          with the files, lines and setting names that show it
//   POST /api/ingest/link | keys | inbox   the person's pick of a Vercel project, a project's tokens, or
//                                          their answer to a waiting service
//   GET  /api/reader/view                  the organization as the dashboard shows it, for the panel
//
// Never a key's value, a file's contents, or code. Only to stackwarden.vercel.app, or to a
// Stackwarden on this computer.

import { createHash } from 'node:crypto';

export const DEFAULT_URL = 'https://stackwarden.vercel.app';

/** Whether a Stackwarden address is one the plugin talks to. @param {string} url */
export function trustedServer(url) {
  try {
    const { protocol, hostname, origin } = new URL(url);
    if (origin === DEFAULT_URL) return true;
    return (protocol === 'http:' || protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
  } catch {
    return false;
  }
}

/** The address to use: the one this computer connected to, else the plugin's setting, else the default. */
export function stackwardenUrl(/** @type {{ url: string } | null} */ config, env = process.env) {
  const chosen = config?.url ?? env.STACKWARDEN_URL ?? DEFAULT_URL;
  return trustedServer(chosen) ? chosen : DEFAULT_URL;
}

// What Stackwarden's refusal codes mean. Only the code is read, never its message.
const REFUSED = /** @type {Record<string, string>} */ ({
  invalid_key: "This computer isn't connected to Stackwarden any more: connect it again, it's one click.",
  not_member: 'Your role in the organization is viewer, so this computer cannot send to it.',
  not_admin: 'Only an admin of the organization can connect a new account.',
  connected_otherwise: 'This Vercel account is connected to Stackwarden another way, with a token or the integration.',
  read_by_another: 'Another member reads this Vercel account through their own CLI.',
  other_login: 'This Vercel account was connected through another Vercel CLI login.',
  older_reading: 'A newer reading of this account is stored already.',
  busy: 'Stackwarden is storing another reading of this account: try again in a minute.',
  no_project: 'This repo has no project in Stackwarden yet: send its scan first.',
  not_found: "That Vercel project isn't in the account I read: read Vercel again, then pick.",
  in_another_project: 'That Vercel project is in another project already.',
  repo_elsewhere: 'Another project in this organization has this repo already.',
  no_account: "Stackwarden hasn't got this Vercel team yet: read Vercel first.",
  no_resource: "That Vercel project isn't in the team I read: read Vercel again.",
  unknown_key: "A token isn't one I read in this team: read Vercel again, then choose.",
  link_failed: "That service couldn't be linked: approve it on the dashboard, where you can pick.",
  rate_limited: 'Stackwarden asks to wait a little before sending again.',
  invalid_reading: "Stackwarden refused the reading: a name in it looks like a key's value.",
  invalid_scan: "Stackwarden refused the scan: a name or path in it looks like a key's value.",
});

/**
 * One request, with JSON both ways. No `Origin` header, which Stackwarden refuses from a reader.
 * @param {string} base
 * @param {string} path
 * @param {{ method?: string, key?: string, secret?: string, body?: unknown }} options
 */
async function request(base, path, { method = 'GET', key, secret, body } = {}) {
  /** @type {Record<string, string>} */
  const headers = {};
  if (key) headers.authorization = `Bearer ${key}`;
  if (secret) headers['x-pairing-secret'] = secret;
  if (body !== undefined) headers['content-type'] = 'application/json';
  let response;
  try {
    response = await fetch(new URL(path, base), {
      method,
      headers,
      redirect: 'error',
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch {
    throw new Error('Stackwarden could not be reached.');
  }
  const text = await response.text();
  /** @type {any} */
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: response.status, ok: response.ok, json, date: response.headers.get('date') };
}

/** Throws Stackwarden's refusal in plain words. @param {{ status: number, json: any }} answer */
function refused(answer) {
  const code = typeof answer.json?.error === 'string' ? answer.json.error : '';
  throw new Error(REFUSED[code] ?? `Stackwarden didn't take it (${String(answer.status)}).`);
}

/** @param {string} base @param {string} key @param {string} path @param {unknown} body */
async function post(base, key, path, body) {
  const answer = await request(base, path, { method: 'POST', key, body });
  if (!answer.ok) refused(answer);
  return answer.json;
}

export const sendScan = (/** @type {string} */ base, /** @type {string} */ key, /** @type {unknown} */ scan) =>
  post(base, key, '/api/ingest/scan', scan);
export const sendLink = (/** @type {string} */ base, /** @type {string} */ key, /** @type {unknown} */ link) =>
  post(base, key, '/api/ingest/link', link);
export const sendKeys = (/** @type {string} */ base, /** @type {string} */ key, /** @type {unknown} */ keys) =>
  post(base, key, '/api/ingest/keys', keys);
export const sendInbox = (/** @type {string} */ base, /** @type {string} */ key, /** @type {unknown} */ answer) =>
  post(base, key, '/api/ingest/inbox', answer);

/** The organization as the dashboard shows it. @param {string} base @param {string} key */
export async function getView(base, key) {
  const answer = await request(base, '/api/reader/view', { key });
  if (!answer.ok) refused(answer);
  return answer.json;
}

export const sha256 = (/** @type {string} */ text) => createHash('sha256').update(text, 'utf8').digest('hex');

// Shapes of well-known keys and tokens, never sent even inside a name or a path. Stackwarden checks
// every request again, more thoroughly, and refuses one that holds anything shaped like a secret.
const SECRET_SHAPES = [
  /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}/,
  /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}|\bgithub_pat_[A-Za-z0-9_]{20,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b|\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bswk_[A-Za-z0-9_-]{43}\b/,
];

/** Whether a text looks like it holds a key or a token. @param {string} text */
export const looksSecret = (text) => SECRET_SHAPES.some((shape) => shape.test(text));

/**
 * Sends what a CLI answered, and gets back what Stackwarden stored and the summary the panel shows.
 * @param {string} base @param {string} key @param {unknown} reading
 */
export const sendReading = (base, key, reading) => post(base, key, '/api/ingest/cli-reading', reading);

/**
 * Starts connecting this computer. Stackwarden gets only hashes of the key and the secret.
 * @param {string} base
 * @param {Record<string, unknown>} body
 */
export async function startPairing(base, body) {
  const answer = await request(base, '/api/reader/pairings', { method: 'POST', body });
  if (answer.status === 429) throw new Error('Stackwarden asks to wait a few minutes before connecting again.');
  if (!answer.ok || typeof answer.json?.id !== 'string') {
    throw new Error(`Stackwarden didn't start connecting (${String(answer.status)}).`);
  }
  return { ...answer.json, date: answer.date };
}

/** Whether the person approved yet. @param {string} base @param {string} id @param {string} secret */
export async function pairingStatus(base, id, secret) {
  const answer = await request(base, `/api/reader/pairings/${encodeURIComponent(id)}`, { secret });
  return answer.ok && typeof answer.json?.status === 'string' ? String(answer.json.status) : 'pending';
}

/**
 * Turns the browser's one-time grant into this computer's key, retrying only when Stackwarden is down.
 * @param {string} base @param {string} id @param {string} secret @param {{ grant: string, code_verifier: string }} body
 */
export async function redeemGrant(base, id, secret, body) {
  for (const wait of [0, 1000, 2000]) {
    if (wait) await new Promise((done) => setTimeout(done, wait));
    try {
      const answer = await request(base, `/api/reader/pairings/${encodeURIComponent(id)}/redeem`, {
        method: 'POST',
        secret,
        body,
      });
      if (answer.ok && Array.isArray(answer.json?.organizations)) return answer.json;
      if (answer.status < 500) return null;
    } catch {
      // Not reached: try again.
    }
  }
  return null;
}

/** Revokes a key this computer no longer uses. @param {string} base @param {string} key */
export async function revokeKey(base, key) {
  try {
    await request(base, '/api/reader/key', { method: 'DELETE', key });
  } catch {
    // It expires by itself within 90 days.
  }
}
