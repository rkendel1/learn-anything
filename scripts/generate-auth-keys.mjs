/**
 * Generates the RS256 signing key pair Convex Auth needs.
 *
 * Run `npm run auth:keys`, then apply the two files to a deployment:
 *   cat .auth/jwt_private_key.pem | npx convex env set --force JWT_PRIVATE_KEY
 *   cat .auth/jwks.json | npx convex env set --force JWKS
 * `.auth/` is git-ignored. Rotating these keys signs every user out.
 */
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const dir = ".auth";
const privateKeyPath = `${dir}/jwt_private_key.pem`;
const jwksPath = `${dir}/jwks.json`;
const force = process.argv.includes("--force");

if (existsSync(privateKeyPath) && !force) {
  console.error(
    `${dir}/ already contains a key pair. Re-run with --force only if you\n` +
      "intend to rotate the keys and sign every current user out.",
  );
  process.exit(1);
}

const { privateKey, publicKey } = await generateKeyPair("RS256", {
  extractable: true,
});

const privatePem = (await exportPKCS8(privateKey)).trimEnd();
const publicJwk = await exportJWK(publicKey);
const jwks = JSON.stringify({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });

mkdirSync(dir, { recursive: true });
writeFileSync(privateKeyPath, `${privatePem}\n`, { mode: 0o600 });
writeFileSync(jwksPath, `${jwks}\n`);

console.log(`Wrote ${privateKeyPath} and ${jwksPath}.`);
console.log("Apply them to the deployment the app uses:");
console.log(`  cat ${privateKeyPath} | npx convex env set --force JWT_PRIVATE_KEY`);
console.log(`  cat ${jwksPath} | npx convex env set --force JWKS`);
console.log("Add --prod or --deployment <name> to target another deployment.");
