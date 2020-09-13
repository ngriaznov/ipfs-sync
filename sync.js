const IPFS = require("ipfs");
var fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
let rootCid = "";

async function readConfig() {
  if (await fs.pathExists("./config.json")) {
    return await fs.readJson("./config.json");
  }
  return [];
}

async function writeConfig(config) {
  await fs.writeJson("./config.json", config);
}

async function upsertFile(ipfs, name, contents) {
  let create = false;

  try {
    await ipfs.files.stat(name);
  } catch {
    create = true;
  }

  if (!create) {
    await ipfs.files.rm(name);
  }

  await ipfs.files.write(name, contents, {
    create: create,
    parents: create,
  });

  console.log(`Added or updated file: ${name}.`);
}

async function deleteFile(ipfs, name) {
  await ipfs.files.rm(name);
}

async function initIpfs(directory) {
  await fs.ensureDir(directory);

  // Create IPFS
  const ipfs = await IPFS.create({ silent: true });
  const rootName = path.basename(directory);

  // Create root folder and print CID
  const config = await readConfig();
  const rootConfig = config.find((c) => c.root == directory);
  if (rootConfig) {
    rootCid = rootConfig.cid;
  } else {
    try {
      await ipfs.files.mkdir(`/${rootName}`);
    } catch {
      // Ignore if folder exists
    }

    let root = await ipfs.files.stat(`/${rootName}`);
    rootCid = root.cid.string;
    config.push({ root: directory, cid: rootCid });
    writeConfig(config);
  }

  console.log(rootCid);

  chokidar.watch(directory).on(
    "add",
    async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await upsertFile(
        ipfs,
        path.join(`/ipfs/${rootCid}`, relativeName),
        fs.readFileSync(filePath)
      );
    },
    {
      ignored: (path) => path.includes("DS_Store"),
    }
  );
  chokidar.watch(directory).on(
    "unlink",
    async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await deleteFile(ipfs, path.join(`/ipfs/${rootCid}`, relativeName));
    },
    {
      ignored: (path) => path.includes("DS_Store"),
    }
  );
  chokidar.watch(directory).on(
    "change",
    async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await upsertFile(
        ipfs,
        path.join(`/ipfs/${rootCid}`, relativeName),
        fs.readFileSync(filePath)
      );
    },
    {
      ignored: (path) => path.includes("DS_Store"),
    }
  );
}

const args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: ipfs-sync folder");
  process.exit();
}

const folder = args[0];

console.log(`Target folder: ${folder}`);

initIpfs(folder);
