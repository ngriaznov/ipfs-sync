const IPFS = require("ipfs");
const OrbitDB = require("orbit-db");
var fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
const sleep = require('util').promisify(setTimeout)

let ipfs;
let db;

async function upsertFile(root, name, contents) {
  name = `/${root}/${name}`;

  const id = name;
  const uploadPath = `/upload/${id}`;

  await ipfs.files.write(uploadPath, contents, { create: true, parents: true });
  try {
    await ipfs.files.stat(name);
    await ipfs.files.rm(name);
  } catch {}

  await ipfs.files.cp(uploadPath, name, { parents: true });
  await ipfs.files.rm(uploadPath);

  await updateRootHash(root);
}

async function deleteFile(root, name) {
  await ipfs.files.rm(name);
  await updateRootHash(root);
}

async function updateRootHash(root) {
  const rstats = await ipfs.files.stat("/");
  let storage = await db.get('directories');
  let entries = new Map();
  
  if (storage && storage.length > 0) {
    entries = storage[0].entries;
  }

  entries.set(root, rstats.cid.string);
  await db.put({
    _id: "directories",
    entries
  }, { pin: true });
}

async function initIpfs(directory) {

  const ipfsOptions = {
    EXPERIMENTAL: {
      pubsub: true
    },
    repo: 'sync',
    start: true
  }

  ipfs = await IPFS.create(ipfsOptions);

  // Init Orbit
  const orbitdb = await OrbitDB.createInstance(ipfs);
  const publicAccess = false;

  // Create / Open a database
  db = await orbitdb.docs('system', {
    create: true, 
    overwrite: true,
    localOnly: false,
    type: 'docstore',
    accessController: {
      write: publicAccess ? ['*'] : [orbitdb.identity.id],
    }
  });

  // Listen for updates from peers
  db.events.on("replicated", (address) => {
    console.log(db.iterator({ limit: -1 }).collect());
  });  
  await db.load();
  
  console.log(`Orbit DB shared on ${db.address.toString()}`);
  setInterval(async () => {
    await db.put({ _id: "system", initialized: true });
  }, 1000);

  return directory;
}

async function initWatch(directory) {

  await fs.ensureDir(directory);

  const root = path.basename(directory);
  const files = await ipfs.files.ls("/");

  for await (const file of files) {
    await ipfs.files.rm(`/${file.name}`, { recursive: true });
  }

  chokidar.watch(directory).on("add", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await upsertFile(root, relativeName, fs.readFileSync(filePath));
  });
  chokidar.watch(directory).on("unlink", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await deleteFile(root, relativeName);
  });
  chokidar.watch(directory).on("change", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await upsertFile(root, relativeName, fs.readFileSync(filePath));
  });
}

const args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: ipfs-sync folder");
  process.exit();
}

const folder = args[0];

initIpfs(folder).then(d => initWatch(d));
