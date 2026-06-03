// Génère une paire de clés VAPID (P-256) pour le Web Push (tâche B3).
// Usage : node scripts/gen-vapid.mjs  → coller les 3 lignes dans l'environnement.
import crypto from "node:crypto";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const pub = publicKey.export({ format: "jwk" });
const priv = privateKey.export({ format: "jwk" });

// Clé publique = point non compressé 0x04 || X || Y, encodé base64url (applicationServerKey).
const rawPub = Buffer.concat([
  Buffer.from([4]),
  Buffer.from(pub.x, "base64url"),
  Buffer.from(pub.y, "base64url"),
]);

console.log("VAPID_PUBLIC_KEY=" + rawPub.toString("base64url"));
console.log("VAPID_PRIVATE_KEY=" + priv.d);
console.log("VAPID_SUBJECT=mailto:milo@mindlog.today");
