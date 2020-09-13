const { v4: uuidv4 } = require('uuid');

const IPFS = require("ipfs");
var fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");

let ipfs;

async function upsertFile(name, contents) {
  const id = uuidv4();
  const uploadPath = `/upload/${id}`;
  await ipfs.files.write(uploadPath, contents, { create: true, parents: true });
  try {
    await ipfs.files.stat(name);
    await ipfs.files.rm(name);
  } catch {
  }

  await ipfs.files.cp(uploadPath, name, { parents: true });
  await ipfs.files.rm(uploadPath);

  const rstats = await ipfs.files.stat('/');
  console.log(rstats.cid.string);
}

async function deleteFile(name) {
  await ipfs.files.rm(name);
}

async function initIpfs(directory) {
  await fs.ensureDir(directory);

  ipfs = await IPFS.create({ silent: true, repo: "./sync" });

  const root = path.basename(directory);
  const stats = await ipfs.files.stat('/');
  const files = await ipfs.files.ls('/');

  for await (const file of files) {
    await ipfs.files.rm(`/${file.name}`, { recursive: true });
  }

  console.log(stats.cid.string);

  chokidar.watch(directory).on("add", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await upsertFile(
      `/${root}/${relativeName}`,
      fs.readFileSync(filePath)
    );
  });
  chokidar.watch(directory).on("unlink", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await deleteFile(`/${root}/${relativeName}`);
  });
  chokidar.watch(directory).on("change", async (filePath) => {
    const relativeName = path.relative(directory, filePath);
    await upsertFile(
      `/${root}/${relativeName}`,
      fs.readFileSync(filePath)
    );
  });
}

const args = process.argv.slice(2);

if (args.length == 0) {
  console.log("Usage: ipfs-sync folder");
  process.exit();
}

const folder = args[0];

console.log(`Target folder: ${folder}`);

initIpfs(folder);
