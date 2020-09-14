const IPFS = require("ipfs");
var fs = require("fs-extra");
const path = require("path");
const chokidar = require("chokidar");
const { resolve } = require('path');
const { readdir } = require('fs').promises;

let ipfs;
let hashStorage;

async function addFile(root, name, contents) {
  name = `/${root}/${name}`;

  console.log(`Add file: ${name}`);

  const id = name;
  const uploadPath = `/upload/${id}`;

  await ipfs.files.write(uploadPath, contents, { create: true, parents: true });
  try {
    await ipfs.files.stat(name);
    await ipfs.files.rm(name);
  } catch {}

  await ipfs.files.cp(uploadPath, name, { parents: true });
  await ipfs.files.rm(uploadPath);

  await hash(root);
}

async function removeFile(root, name) {
  console.log(`Remove file: ${name}`);

  await ipfs.files.rm(name);
  await hash(root);
}

async function hash(root) {
  const rstats = await ipfs.files.stat("/");
  let storage = Object.assign({});
  await list(storage, null, `/${root}`);
  console.log('Hash:');
  console.log(storage);
  await fs.writeJSON(hashStorage, storage);
}

async function list(source, parent, name) {
  const entry = parent ? path.join(parent, name) : name;

  const rstats = await ipfs.files.stat(entry);
  source.path = entry;
  source.cid = rstats.cid.string;

  source.children = [];

  for await (const file of ipfs.files.ls(entry)) {
    try {
      let child = Object.assign({});
      if (file.type == "file") {
        const cstats = await ipfs.files.stat(path.join(parent, file.name));
        child.path = path.join(parent, file.name);
        child.cid = cstats.cid.string;
      } else {
        if (!entry.endsWith(file.name)) {
          child = await list(child, entry, file.name);
        } else {
          child = null;
        }
      }

      if (child) {
        source.children.push(child);
      }
    } catch {}
  }

  return source;
}

async function* getFiles(dir) {
  const dirents = await readdir(dir, { withFileTypes: true });
  for (const dirent of dirents) {
    const res = resolve(dir, dirent.name);
    if (dirent.isDirectory()) {
      yield* getFiles(res);
    } else {
      yield res;
    }
  }
}

async function start() {
  const config = fs.readJsonSync("config.json");
  console.log(`Hash: ${config.output}`);

  hashStorage = config.output;
  ipfs = await IPFS.create();

  config.paths.forEach(async (directory) => {
    console.log(`Add directory: ${directory}`);
    await fs.ensureDir(directory);

    const root = path.basename(directory);

    for await (const f of getFiles(directory)) {
      const relativeName = path.relative(directory, f);
      await addFile(root, relativeName, fs.readFileSync(f));
    }

    chokidar.watch(directory).on("add", async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await addFile(root, relativeName, fs.readFileSync(filePath));
    });
    chokidar.watch(directory).on("unlink", async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await removeFile(root, relativeName);
    });
    chokidar.watch(directory).on("change", async (filePath) => {
      const relativeName = path.relative(directory, filePath);
      await addFile(root, relativeName, fs.readFileSync(filePath));
    });
  });
}

start();
