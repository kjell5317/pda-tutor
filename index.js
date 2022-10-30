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
    let driver = await new Builder().forBrowser("chrome").build();
    let result = [];
    try {
      await driver.get(
        `https://elearning.uni-oldenburg.de/dispatch.php/course/files/index/${config.folder_id[blatt]}?cid=${config.course_id}`
      );
      await driver
        .findElement(By.css("#username"))
        .sendKeys(config.stud_ip.name);
      await driver
        .findElement(By.css("#password"))
        .sendKeys(config.stud_ip.password, Key.RETURN);
      await driver.wait(until.elementLocated(By.css("tbody.files tr")), 10000);
      let files = await driver.findElements(By.css("tbody.files tr"));
      for (const file of files) {
        let id = (await file.getAttribute("id")).replace("fileref_", "");
        result.push(await this.apiRequest(`file/${id}`));
      }
    } finally {
      await driver.quit();
    }
    return result;
  }

  async sortFiles(files) {
    if (!files) return;
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
const { Builder, By, Key, until } = require("selenium-webdriver");
const fs = require("fs");

let blatt = process.argv.slice(2)[0];
if (blatt < 1 || blatt > config.maxBlatt)
  throw new Error("Es ist kein Übungsblatt mit dieser Nummer vorhanden");
if (blatt < 10) blatt = "0" + blatt;

let prio = process.argv.slice(2)[1];
if (prio < 1 || prio > config.tutors)
  throw new Error("Es gibt nicht genügend Tutoren");

if (blatt == null || prio == null)
  throw new Error("Blatt oder Priorität nicht definiert");

let all = false;
if (process.argv.slice(2)[2] === "-a" || process.argv.slice(2)[2] === "--all") {
  all = true;
}

let studIP = new StudIP();
(async function () {
  let files = await studIP.getAllFilesInFolder(blatt);
  let sortedFiles = await studIP.sortFiles(files);

  if (!sortedFiles) return;
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(length + "+" + rest);

  let download = sortedFiles.slice(
    (prio - 1) * length,
    (prio - 1) * length + length
  );
  for (i = 0; i < rest; i++) {
    if (prio == i) {
      download.push(sortedFiles[sortedFiles.length - 1 - rest + i]);
    }
  }
  await studIP.downloadFiles(download);
})();
