// Diagnostic : qui est abonné à qui dans space_subscriptions ?
// Affiche aussi les premium_space et les livestreams actifs.
import { db } from "../src/db.js";
import { identities, spaceSubscriptions, premiumSpace, liveStreams } from "../src/schema.js";

async function main() {
  console.log("\n── IDENTITÉS ────────────────────────────────────────");
  const ids = await db.select().from(identities);
  for (const i of ids) console.log(`  #${i.id}  @${i.handle}`);

  console.log("\n── PREMIUM_SPACE ────────────────────────────────────");
  const sp = await db.select().from(premiumSpace);
  if (!sp.length) console.log("  (vide)");
  for (const s of sp) {
    const owner = ids.find((i) => i.id === s.identity_id);
    console.log(`  @${owner?.handle ?? "?"}  prix=${s.price_cents}c  active=${s.active}  benefits=${s.benefits || "(défaut)"}`);
  }

  console.log("\n── SPACE_SUBSCRIPTIONS ──────────────────────────────");
  const subs = await db.select().from(spaceSubscriptions);
  if (!subs.length) console.log("  (vide — c'est LE problème : aucune relation owner↔subscriber)");
  for (const s of subs) {
    const owner = ids.find((i) => i.id === s.owner_identity_id);
    const sub = ids.find((i) => i.id === s.subscriber_identity_id);
    console.log(`  @${sub?.handle ?? "?"}  →  @${owner?.handle ?? "?"}  provider=${s.provider}  status=${s.status}  jusqu'à=${s.current_period_end}`);
  }

  console.log("\n── LIVE_STREAMS ─────────────────────────────────────");
  const streams = await db.select().from(liveStreams);
  if (!streams.length) console.log("  (aucun)");
  for (const s of streams) {
    const owner = ids.find((i) => i.id === s.owner_identity_id);
    console.log(`  @${owner?.handle ?? "?"}  ${s.id}  status=${s.status}  démarré=${s.started_at}`);
  }
  console.log();
}

void main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
