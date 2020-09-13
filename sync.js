const IPFS = require("ipfs");
const OrbitDB = require("orbit-db");
var fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");

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
    console.log(`Root hash: ${rstats.cid.string}`);
    let storage = await db.get('distribution');
    if (!storage) {
        storage = [];
    }
    storage[root] = rstats.cid.string;
    await db.put({
        _id: 'distribution',
        entries: storage
    });
}

async function initIpfs(directory) {
  ipfs = await IPFS.create({ silent: true, repo: "./sync" });

  // Init Orbit
  const orbitdb = await OrbitDB.createInstance(ipfs);

  // Create / Open a database
  db = await orbitdb.docstore("system", { sync: true });
  await db.load();

  console.log(`System: ${db.address.toString()}`);

  // Listen for updates from peers
  db.events.on("replicated", (address) => {
    console.log(db.iterator({ limit: -1 }).collect());
  });

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

initIpfs(folder);
