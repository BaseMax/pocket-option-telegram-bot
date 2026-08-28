const path = process.env.HEARTBEAT_PATH ?? './data/heartbeat';
const maxAgeSeconds = Number(process.env.HEARTBEAT_MAX_AGE_SECONDS ?? '120');

const file = Bun.file(path);
if (!(await file.exists())) {
  console.error(`no heartbeat at ${path}`);
  process.exit(1);
}

const written = Number((await file.text()).trim());
if (!Number.isFinite(written)) {
  console.error(`heartbeat at ${path} is not a timestamp`);
  process.exit(1);
}

const ageSeconds = Math.round((Date.now() - written) / 1000);
if (ageSeconds > maxAgeSeconds) {
  console.error(`heartbeat is ${ageSeconds}s old, over the ${maxAgeSeconds}s limit`);
  process.exit(1);
}

console.log(`heartbeat is ${ageSeconds}s old`);
