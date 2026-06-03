/**
 * @experimental Prototype de référence — non utilisé en production.
 * Conservé pour tests de vecteurs cryptographiques et future intégration.
 *
 * Double Ratchet + X3DH — implémentation de référence (forward secrecy).
 *
 * Construit UNIQUEMENT sur des primitives présentes à l'identique dans WebCrypto
 * (navigateur & Node) et dans Java JCA (Android) :
 *   - ECDH P-256 pour le pas DH (secret = coordonnée X brute, 32 o) ;
 *   - HKDF-SHA256 pour les chaînes racine (RK) et l'expansion de clé message (MK) ;
 *   - HMAC-SHA256 pour la chaîne symétrique (CK) ;
 *   - AES-GCM-256 pour le chiffrement de message.
 *
 * Ce module est volontairement sans dépendance et déterministe (on peut injecter
 * les keypairs éphémères) afin de générer les vecteurs de test partagés
 * (test/vectors/ratchet.json) que le client Android rejoue à l'identique.
 *
 * Réfs : Signal « The X3DH Key Agreement Protocol » et « The Double Ratchet Algorithm ».
 */

// Types WebCrypto pris depuis node:crypto (la lib TS n'inclut pas DOM). Au runtime,
// navigateur et Node exposent la MÊME API `crypto.subtle` — le portage web de ce
// module (public/app.js) utilise `globalThis.crypto.subtle` à l'identique.
import { webcrypto } from "node:crypto";
const subtle = webcrypto.subtle;

/* ----------------------------- encodage octets --------------------------- */

export type Jwk = webcrypto.JsonWebKey;
export interface KeyPair {
  priv: Jwk;
  pub: Jwk;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}
export function unb64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function b64u(bytes: Uint8Array): string {
  return b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function unb64u(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return unb64(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
}
function concat(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/* ------------------------------ primitives ------------------------------- */

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** Génère un keypair ECDH P-256 (export JWK priv/pub). */
export async function generateKeyPair(): Promise<KeyPair> {
  const kp = await subtle.generateKey(ECDH, true, ["deriveBits"]);
  const [priv, pub] = await Promise.all([
    subtle.exportKey("jwk", kp.privateKey),
    subtle.exportKey("jwk", kp.publicKey),
  ]);
  return { priv, pub };
}

// Générateur de keypairs ratchet, injectable pour des vecteurs déterministes.
// En prod il reste aléatoire ; les tests d'interop injectent une séquence fixe.
let _genKeyPair: () => Promise<KeyPair> = generateKeyPair;
export function setKeyPairGenerator(fn: (() => Promise<KeyPair>) | null): void {
  _genKeyPair = fn ?? generateKeyPair;
}

/** Extrait la clé publique (x/y seuls) d'un keypair / d'une privée JWK. */
export function publicOf(k: KeyPair | Jwk): Jwk {
  const j = "priv" in k ? k.pub : k;
  return { kty: "EC", crv: "P-256", x: j.x, y: j.y, ext: true };
}

function req(v: string | undefined, what: string): string {
  if (v == null) throw new Error(`JWK incomplet : ${what} manquant`);
  return v;
}

/** Représentation brute 64 o (x||y) d'une clé publique P-256 — sert d'AD X3DH. */
export function rawPub(pub: Jwk): Uint8Array {
  return concat(unb64u(req(pub.x, "x")), unb64u(req(pub.y, "y")));
}

/** Secret ECDH brut (coordonnée X, 32 o) — identique WebCrypto/JCA. */
export async function ecdh(priv: Jwk, pub: Jwk): Promise<Uint8Array> {
  const [privKey, pubKey] = await Promise.all([
    subtle.importKey("jwk", priv, ECDH, false, ["deriveBits"]),
    subtle.importKey("jwk", publicOf(pub), ECDH, false, []),
  ]);
  const bits = await subtle.deriveBits({ name: "ECDH", public: pubKey }, privKey, 256);
  return new Uint8Array(bits);
}

export async function hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, len: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, len * 8);
  return new Uint8Array(bits);
}

export async function hmac(keyBytes: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle.sign("HMAC", key, msg));
}

async function aesEncrypt(keyBytes: Uint8Array, iv: Uint8Array, plain: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, plain);
  return new Uint8Array(ct);
}
async function aesDecrypt(keyBytes: Uint8Array, iv: Uint8Array, ct: Uint8Array, aad: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
  const pt = await subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ct);
  return new Uint8Array(pt);
}

/* --------------------------------- KDF ----------------------------------- */

const INFO_X3DH = enc.encode("mindlog-x3dh-v1");
const INFO_RK = enc.encode("mindlog-ratchet-rk-v1");
const INFO_MSG = enc.encode("mindlog-msg-v1");
const ZERO32 = new Uint8Array(32);
const FF32 = new Uint8Array(32).fill(0xff);

/** KDF_RK : (RK, dh) → (RK', CK) via HKDF-SHA256 (salt = RK). */
async function kdfRk(rk: Uint8Array, dh: Uint8Array): Promise<{ rk: Uint8Array; ck: Uint8Array }> {
  const out = await hkdf(dh, rk, INFO_RK, 64);
  return { rk: out.slice(0, 32), ck: out.slice(32, 64) };
}
/** KDF_CK : CK → (CK', MK) via HMAC-SHA256 (constantes 0x02 / 0x01). */
async function kdfCk(ck: Uint8Array): Promise<{ ck: Uint8Array; mk: Uint8Array }> {
  const nextCk = await hmac(ck, new Uint8Array([0x02]));
  const mk = await hmac(ck, new Uint8Array([0x01]));
  return { ck: nextCk, mk };
}
/** KDF_MK : MK → (clé AES 32 o, IV déterministe 12 o) via HKDF-SHA256. */
async function kdfMk(mk: Uint8Array): Promise<{ key: Uint8Array; iv: Uint8Array }> {
  const t = await hkdf(mk, ZERO32, INFO_MSG, 44);
  return { key: t.slice(0, 32), iv: t.slice(32, 44) };
}

/* --------------------------------- X3DH ---------------------------------- */

export interface PrekeyBundle {
  ik: Jwk; // clé d'identité publique du destinataire (B)
  spkPub: Jwk; // signed prekey publique de B
  spkId: number;
  opkPub?: Jwk | null; // one-time prekey publique de B (peut manquer)
  opkId?: number | null;
}

/** Côté initiateur A : calcule SK + l'AD de session à partir du bundle de B. */
export async function x3dhInitiator(
  ikA: KeyPair,
  ekA: KeyPair,
  bundle: PrekeyBundle
): Promise<{ sk: Uint8Array; ad: Uint8Array }> {
  const dh1 = await ecdh(ikA.priv, bundle.spkPub); // ECDH(IK_A, SPK_B)
  const dh2 = await ecdh(ekA.priv, bundle.ik); // ECDH(EK_A, IK_B)
  const dh3 = await ecdh(ekA.priv, bundle.spkPub); // ECDH(EK_A, SPK_B)
  const parts = [FF32, dh1, dh2, dh3];
  if (bundle.opkPub) parts.push(await ecdh(ekA.priv, bundle.opkPub)); // DH4 optionnel
  const sk = await hkdf(concat(...parts), ZERO32, INFO_X3DH, 32);
  const ad = concat(rawPub(ikA.pub), rawPub(bundle.ik));
  return { sk, ad };
}

/** Côté destinataire B : reproduit SK + AD à partir des clés publiques de A. */
export async function x3dhResponder(
  ikB: KeyPair,
  spkB: KeyPair,
  opkB: KeyPair | null,
  ikAPub: Jwk,
  ekAPub: Jwk
): Promise<{ sk: Uint8Array; ad: Uint8Array }> {
  const dh1 = await ecdh(spkB.priv, ikAPub); // = ECDH(IK_A, SPK_B)
  const dh2 = await ecdh(ikB.priv, ekAPub); // = ECDH(EK_A, IK_B)
  const dh3 = await ecdh(spkB.priv, ekAPub); // = ECDH(EK_A, SPK_B)
  const parts = [FF32, dh1, dh2, dh3];
  if (opkB) parts.push(await ecdh(opkB.priv, ekAPub)); // = DH4
  const sk = await hkdf(concat(...parts), ZERO32, INFO_X3DH, 32);
  const ad = concat(rawPub(ikAPub), rawPub(ikB.pub));
  return { sk, ad };
}

/* ----------------------------- Double Ratchet ---------------------------- */

export const MAX_SKIP = 1000; // clés sautées max sur une chaîne donnée
export const MAX_SKIPPED_STORE = 2000; // total des clés sautées conservées

interface SkippedEntry {
  dh: string; // clé publique ratchet (b64u de rawPub) du pair
  n: number;
  mk: string; // b64 de la clé message
}

/** État du ratchet pour UNE conversation (sérialisable JSON). */
export interface RatchetState {
  rk: string; // b64
  dhs: KeyPair; // mon keypair ratchet courant
  dhr: Jwk | null; // clé publique ratchet du pair
  cks: string | null; // chaîne d'envoi (b64)
  ckr: string | null; // chaîne de réception (b64)
  ns: number;
  nr: number;
  pn: number;
  ad: string; // b64 de l'AD de session (IK_A||IK_B)
  skipped: SkippedEntry[]; // FIFO bornée
}

/** En-tête transmis en clair (authentifié comme AD), packé dans le ciphertext. */
export interface RatchetHeader {
  v: 2;
  dh: Jwk; // ma clé publique ratchet courante (x/y)
  pn: number;
  n: number;
  // champs bootstrap X3DH (présents tant que le pair n'a pas répondu) :
  ek?: Jwk; // clé éphémère de l'initiateur
  ik?: Jwk; // clé d'identité de l'initiateur
  opk?: number; // id de l'OPK consommée chez le destinataire
  spk?: number; // id de la SPK utilisée
}

function headerBytes(headerB64u: string): Uint8Array {
  return enc.encode(headerB64u);
}

/** Initialise l'état côté initiateur A (RK = SK ; DHr = SPK de B). */
export async function initSender(sk: Uint8Array, ad: Uint8Array, spkB: Jwk): Promise<RatchetState> {
  const dhs = await _genKeyPair();
  const dhOut = await ecdh(dhs.priv, spkB);
  const { rk, ck } = await kdfRk(sk, dhOut);
  return {
    rk: b64(rk),
    dhs,
    dhr: publicOf(spkB),
    cks: b64(ck),
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    ad: b64(ad),
    skipped: [],
  };
}

/** Initialise l'état côté destinataire B (RK = SK ; DHs = keypair SPK). */
export function initReceiver(sk: Uint8Array, ad: Uint8Array, spkB: KeyPair): RatchetState {
  return {
    rk: b64(sk),
    dhs: { priv: spkB.priv, pub: publicOf(spkB.pub) },
    dhr: null,
    cks: null,
    ckr: null,
    ns: 0,
    nr: 0,
    pn: 0,
    ad: b64(ad),
    skipped: [],
  };
}

export interface EncryptResult {
  state: RatchetState;
  headerB64u: string; // header JSON encodé base64url
  ct: string; // ciphertext AES-GCM en base64
  iv: string; // IV déterministe base64 (porté par la colonne `iv`)
}

/** Chiffre `plaintext`. `bootstrap` ajoute les champs X3DH au header (1ers msgs). */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string,
  bootstrap?: Pick<RatchetHeader, "ek" | "ik" | "opk" | "spk">
): Promise<EncryptResult> {
  if (!state.cks) throw new Error("chaîne d'envoi absente");
  const { ck, mk } = await kdfCk(unb64(state.cks));
  state.cks = b64(ck);
  const header: RatchetHeader = { v: 2, dh: publicOf(state.dhs.pub), pn: state.pn, n: state.ns, ...bootstrap };
  state.ns += 1;
  const headerB64u = b64u(enc.encode(JSON.stringify(header)));
  const { key, iv } = await kdfMk(mk);
  const aad = concat(unb64(state.ad), headerBytes(headerB64u));
  const ct = await aesEncrypt(key, iv, enc.encode(plaintext), aad);
  return { state, headerB64u, ct: b64(ct), iv: b64(iv) };
}

function pushSkipped(state: RatchetState, dh: string, n: number, mk: Uint8Array): void {
  state.skipped.push({ dh, n, mk: b64(mk) });
  while (state.skipped.length > MAX_SKIPPED_STORE) state.skipped.shift();
}

async function trySkipped(state: RatchetState, header: RatchetHeader, iv: string, ct: string, aad: Uint8Array): Promise<string | null> {
  const dh = b64u(rawPub(header.dh));
  const idx = state.skipped.findIndex((e) => e.dh === dh && e.n === header.n);
  if (idx < 0) return null;
  const entry = state.skipped[idx];
  const { key, iv: mkIv } = await kdfMk(unb64(entry.mk));
  if (!eqBytes(mkIv, unb64(iv))) return null;
  const pt = await aesDecrypt(key, unb64(iv), unb64(ct), aad);
  state.skipped.splice(idx, 1); // consommée une seule fois
  return dec.decode(pt);
}

async function skipMessageKeys(state: RatchetState, until: number): Promise<void> {
  if (state.ckr === null) return;
  if (until - state.nr > MAX_SKIP) throw new Error("trop de clés à sauter");
  if (state.dhr === null) return;
  const dh = b64u(rawPub(state.dhr));
  while (state.nr < until) {
    const { ck, mk } = await kdfCk(unb64(state.ckr));
    state.ckr = b64(ck);
    pushSkipped(state, dh, state.nr, mk);
    state.nr += 1;
  }
}

async function dhRatchet(state: RatchetState, header: RatchetHeader): Promise<void> {
  state.pn = state.ns;
  state.ns = 0;
  state.nr = 0;
  state.dhr = publicOf(header.dh);
  let step = await kdfRk(unb64(state.rk), await ecdh(state.dhs.priv, state.dhr));
  state.rk = b64(step.rk);
  state.ckr = b64(step.ck);
  state.dhs = await _genKeyPair();
  step = await kdfRk(unb64(state.rk), await ecdh(state.dhs.priv, state.dhr));
  state.rk = b64(step.rk);
  state.cks = b64(step.ck);
}

/** Déchiffre un message. Retourne le plaintext, ou null si rejeu / clé indispo. */
export async function ratchetDecrypt(
  state: RatchetState,
  headerB64u: string,
  iv: string,
  ct: string
): Promise<string | null> {
  const header = JSON.parse(dec.decode(unb64u(headerB64u))) as RatchetHeader;
  const aad = concat(unb64(state.ad), headerBytes(headerB64u));

  const skipped = await trySkipped(state, header, iv, ct, aad);
  if (skipped !== null) return skipped;

  const headerDh = b64u(rawPub(header.dh));
  const curDhr = state.dhr ? b64u(rawPub(state.dhr)) : null;
  if (headerDh !== curDhr) {
    await skipMessageKeys(state, header.pn);
    await dhRatchet(state, header);
  }
  await skipMessageKeys(state, header.n);
  if (state.ckr === null) return null;
  const { ck, mk } = await kdfCk(unb64(state.ckr));
  const { key, iv: mkIv } = await kdfMk(mk);
  if (!eqBytes(mkIv, unb64(iv))) return null;
  try {
    const pt = await aesDecrypt(key, unb64(iv), unb64(ct), aad);
    state.ckr = b64(ck);
    state.nr += 1;
    return dec.decode(pt);
  } catch {
    return null; // tag invalide → ne pas avancer l'état
  }
}

/* ---------------------- Numéro de sécurité (anti-MITM) ------------------- */
// Empreinte vérifiable hors-bande dérivée des DEUX clés d'identité, façon Signal.
// Identique des deux côtés ; sa comparaison détecte un MITM à l'établissement.

const SN_VERSION = new Uint8Array([0x00, 0x00]);
const SN_ITER = 5200;

async function sha512(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest("SHA-512", data));
}

/** Empreinte 30 chiffres d'un utilisateur (handle + clé d'identité brute 64 o). */
async function userFingerprint(handle: string, ikRaw: Uint8Array): Promise<string> {
  let h = await sha512(concat(SN_VERSION, ikRaw, enc.encode(handle)));
  for (let i = 0; i < SN_ITER; i++) h = await sha512(concat(h, ikRaw));
  let out = "";
  for (let i = 0; i < 6; i++) {
    const c = h.subarray(i * 5, i * 5 + 5);
    // entier 40 bits big-endian (< 2^53, sûr en Number) % 100000
    const n = ((c[0] * 256 + c[1]) * 256 + c[2]) * 256 + c[3];
    const v = (n * 256 + c[4]) % 100000;
    out += String(v).padStart(5, "0");
  }
  return out;
}

/** Compare deux tableaux d'octets (ordre lexicographique). */
function cmpBytes(a: Uint8Array, b: Uint8Array): number {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return a.length - b.length;
}

/** Numéro de sécurité combiné (60 chiffres) — identique pour les deux pairs. */
export async function safetyNumber(myHandle: string, myIk: Jwk, peerHandle: string, peerIk: Jwk): Promise<string> {
  const myRaw = rawPub(publicOf(myIk));
  const peerRaw = rawPub(publicOf(peerIk));
  const mine = await userFingerprint(myHandle, myRaw);
  const theirs = await userFingerprint(peerHandle, peerRaw);
  return cmpBytes(myRaw, peerRaw) <= 0 ? mine + theirs : theirs + mine;
}

/** Met en forme un numéro de sécurité en groupes de 5 chiffres. */
export function groupDigits(sn: string): string {
  return (sn.match(/.{1,5}/g) ?? []).join(" ");
}

/* ----------------------- Sender keys (groupes) --------------------------- */
// Chiffrement de groupe façon « megolm » : chaque membre a une chaîne symétrique
// (mêmes KDF_CK/KDF_MK que le ratchet) + une clé de SIGNATURE ECDSA P-256 (anti-forge
// entre membres). On chiffre une seule fois ; le blob est relayé à tous. La clé
// d'expéditeur (chainKey + clé publique de signature) est distribuée via le canal 1-à-1.

const ECDSA = { name: "ECDSA", namedCurve: "P-256" } as const;

/** Mon état d'expéditeur de groupe (chaîne + clé de signature privée/publique). */
export interface GroupSenderState {
  chainKey: string; // b64
  iter: number;
  sigPriv: Jwk;
  sigPub: Jwk;
}
/** État d'un autre membre côté réception (chaîne + clé publique de signature). */
export interface GroupPeerState {
  chainKey: string; // b64
  iter: number;
  sigPub: Jwk;
  skipped: { n: number; mk: string }[]; // clés sautées (hors-ordre), bornées
}
/** Message de groupe chiffré + signé. */
export interface GroupMsg {
  iter: number;
  iv: string; // b64
  ct: string; // b64
  sig: string; // b64 (ECDSA P-256/SHA-256)
}
/** Clé d'expéditeur distribuée (SKDM, partie publique + chaîne courante). */
export interface SenderKeyDist {
  chainKey: string;
  iter: number;
  sigPub: Jwk;
}

async function ecdsaSign(priv: Jwk, data: Uint8Array): Promise<Uint8Array> {
  const key = await subtle.importKey("jwk", priv, ECDSA, false, ["sign"]);
  return new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data));
}
async function ecdsaVerify(pub: Jwk, sig: Uint8Array, data: Uint8Array): Promise<boolean> {
  const key = await subtle.importKey("jwk", pub, ECDSA, false, ["verify"]);
  return subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, data);
}
function iterBytes(n: number): Uint8Array {
  return enc.encode(String(n));
}

/** Crée un état d'expéditeur de groupe (chaîne aléatoire + paire de signature). */
export async function groupSenderInit(): Promise<GroupSenderState> {
  const chainKey = new Uint8Array(32);
  globalThis.crypto.getRandomValues(chainKey);
  const kp = await subtle.generateKey(ECDSA, true, ["sign", "verify"]);
  const [sigPriv, sigPub] = await Promise.all([
    subtle.exportKey("jwk", kp.privateKey),
    subtle.exportKey("jwk", kp.publicKey),
  ]);
  return { chainKey: b64(chainKey), iter: 0, sigPriv, sigPub };
}

/** La clé d'expéditeur à distribuer aux autres membres (SKDM). */
export function senderKeyDist(s: GroupSenderState): SenderKeyDist {
  return { chainKey: s.chainKey, iter: s.iter, sigPub: publicSig(s.sigPub) };
}
function publicSig(j: Jwk): Jwk {
  return { kty: "EC", crv: "P-256", x: j.x, y: j.y, ext: true };
}
/** Construit l'état de réception d'un membre à partir d'un SKDM reçu. */
export function groupPeerFromDist(d: SenderKeyDist): GroupPeerState {
  return { chainKey: d.chainKey, iter: d.iter, sigPub: d.sigPub, skipped: [] };
}

/** Chiffre + signe un message de groupe ; avance ma chaîne. */
export async function groupEncrypt(s: GroupSenderState, plaintext: string): Promise<GroupMsg> {
  const { ck, mk } = await kdfCk(unb64(s.chainKey));
  const iter = s.iter;
  s.chainKey = b64(ck);
  s.iter += 1;
  const { key, iv } = await kdfMk(mk);
  const ct = await aesEncrypt(key, iv, enc.encode(plaintext), iterBytes(iter));
  const sig = await ecdsaSign(s.sigPriv, concat(iterBytes(iter), iv, ct));
  return { iter, iv: b64(iv), ct: b64(ct), sig: b64(sig) };
}

/** Vérifie la signature puis déchiffre un message de groupe d'un membre. */
export async function groupDecrypt(p: GroupPeerState, m: GroupMsg): Promise<string | null> {
  const iv = unb64(m.iv);
  const ct = unb64(m.ct);
  if (!(await ecdsaVerify(p.sigPub, unb64(m.sig), concat(iterBytes(m.iter), iv, ct)))) return null;
  // Clé déjà dérivée (message hors-ordre) ?
  const idx = p.skipped.findIndex((e) => e.n === m.iter);
  if (idx >= 0) {
    const { key, iv: mkIv } = await kdfMk(unb64(p.skipped[idx].mk));
    if (!eqBytes(mkIv, iv)) return null;
    const pt = await aesDecrypt(key, iv, ct, iterBytes(m.iter)).catch(() => null);
    if (pt) p.skipped.splice(idx, 1);
    return pt ? dec.decode(pt) : null;
  }
  if (m.iter < p.iter) return null; // rejeu / trop ancien
  if (m.iter - p.iter > MAX_SKIP) throw new Error("trop de clés à sauter");
  let ck = unb64(p.chainKey);
  while (p.iter < m.iter) {
    const step = await kdfCk(ck);
    ck = step.ck;
    p.skipped.push({ n: p.iter, mk: b64(step.mk) });
    while (p.skipped.length > MAX_SKIPPED_STORE) p.skipped.shift();
    p.iter += 1;
  }
  const { ck: nextCk, mk } = await kdfCk(ck);
  const { key, iv: mkIv } = await kdfMk(mk);
  if (!eqBytes(mkIv, iv)) return null;
  const pt = await aesDecrypt(key, iv, ct, iterBytes(m.iter)).catch(() => null);
  if (!pt) return null;
  p.chainKey = b64(nextCk);
  p.iter = m.iter + 1;
  return dec.decode(pt);
}

/* --------------------------- transport ciphertext ------------------------ */

/** Pack v2 : base64url(header) + "." + base64(aesGcm). */
export function packCiphertext(headerB64u: string, ct: string): string {
  return headerB64u + "." + ct;
}
export function unpackCiphertext(packed: string): { headerB64u: string; ct: string } | null {
  const dot = packed.indexOf(".");
  if (dot <= 0) return null;
  return { headerB64u: packed.slice(0, dot), ct: packed.slice(dot + 1) };
}
