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

function walk(dir) {
  var results = [];
  var list = fs.readdirSync(dir);
  list.forEach(function(file) {
      file = dir + '/' + file;
      var stat = fs.statSync(file);
      if (stat && stat.isDirectory()) { 
          /* Recurse into a subdirectory */
          results = results.concat(walk(file));
      } else { 
          /* Is a file */
          results.push(file);
      }
  });
  return results;
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
    const files = await ipfs.files.ls("/");

    for await (const file of files) {
      try {
        await ipfs.files.rm(`/${file.name}`, { recursive: true });
      } catch {
      }
    }

    for (const f of walk(directory)) {
      console.log(f);
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
