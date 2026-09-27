#!/usr/bin/env node
// Generate Web Push (VAPID) keys. Put the output in your environment. Generate once; changing
// keys invalidates every existing browser subscription.
import { createECDH } from "node:crypto";
const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
console.log(`VAPID_PUBLIC_KEY="${ecdh.getPublicKey().toString("base64url")}"`);
const d = ecdh.getPrivateKey();
console.log(`VAPID_PRIVATE_KEY="${Buffer.concat([Buffer.alloc(32 - d.length), d]).toString("base64url")}"`);
console.log(`VAPID_SUBJECT="mailto:office@legacyindependentliving.net"`);
