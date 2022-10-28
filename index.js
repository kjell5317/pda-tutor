#!/usr/bin/env node

class StudIP {
  async downloadFiles(sortedFiles) {
    if (!sortedFiles) return;
    console.info(`Downloading ${sortedFiles.length} files.`);
    for (const file of sortedFiles) {
      const path = `${config.downloadPrefix}/UB${blatt}/${file.name}`;
      if (!fs.existsSync(`${config.downloadPrefix}/UB${blatt}`)) {
        fs.mkdirSync(`${config.downloadPrefix}/UB${blatt}`);
      }
      const data = await this.apiRequest(`/file/${file.id}/download`, "file");
      const buffer = Buffer.from(data);
      fs.writeFile(path, buffer, "binary", () => {});
    }
  }

  async getAllFilesInFolder(blatt) {
    let folderId = config.folder_id[blatt];
    const files = await this.apiRequest(`folder/${folderId}/files`);
    const allFiles = [];

    if (!files) return allFiles;
    for (const file in files.collection) allFiles.push(files.collection[file]);
    return allFiles;
  }

  async sortFiles(files) {
    let authors = {};
    let sortedFiles = {};
    for (const file of files) {
      if (file.user_id in authors && authors[file.user_id] <= file.mkdate)
        continue;
      authors[file.user_id] = file.mkdate;
      sortedFiles[file.user_id] = file;
    }
    sortedFiles = Object.values(sortedFiles);
    console.log(files.length + "+" + sortedFiles.length);

    return sortedFiles;
  }

  async apiRequest(path, type) {
    let response = await fetch(config.url + path, {
      method: "GET",
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(
            `${config.stud_ip.name}:${config.stud_ip.password}`
          ).toString("base64"),
      },
    });

    if (!response.ok) {
      console.log("ERROR");
      return;
    }

    switch (type) {
      case "text":
        response = await response.text();
        break;
      case "file":
        response = await response.arrayBuffer();
        break;
      default:
        response = await response.json();
    }

    return response;
  }
}

const config = require("./config.json");

const fetch = require("node-fetch");
const fs = require("fs");

let blatt = process.argv.slice(2)[0];
if (blatt < 1 || blatt > 13)
  throw new Error("Es ist kein Übungsblatt mit dieser Nummer vorhanden");
if (blatt < 10) blatt = "0" + blatt;

let prio = process.argv.slice(2)[1];
if (prio < 1 || prio > config.tutors)
  throw new Error("Es gibt nicht genügend Tutoren");

if (blatt == null || prio == null)
  throw new Error("Blatt oder Priorität nicht definiert");

let studIP = new StudIP();
(async function () {
  let files = await studIP.getAllFilesInFolder(blatt);
  let sortedFiles = await studIP.sortFiles(files);
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(length + "+" + rest);
  await studIP.downloadFiles(
    sortedFiles.slice((prio - 1) * length, (prio - 1) * length + length)
  );
  for (i = 0; i < rest; i++) {
    if (prio == i) {
      await studIP.downloadFiles([
        sortedFiles[sortedFiles.length - 1 - rest + i],
      ]);
    }
  }
})();
