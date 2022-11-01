#!/usr/bin/env node

class StudIP {
  async downloadFiles(sortedFiles, blatt) {
    if (!sortedFiles) return;
    console.info(`Downloading ${sortedFiles.length} files`);
    for (const file of sortedFiles) {
      const path = `${config.downloadPrefix}/UB${blatt}/${file.name}`;
      if (!fs.existsSync(`${config.downloadPrefix}/UB${blatt}`)) {
        fs.mkdirSync(`${config.downloadPrefix}/UB${blatt}`);
      }
      const data = await this.apiRequest(`/file/${file.id}/download`, "file");
      const buffer = Buffer.from(data);
      fs.writeFile(path, buffer, "binary", () => {});

      if (!fs.existsSync(path.replace(".zip", ""))) {
        fs.mkdirSync(path.replace(".zip", ""));
      }
      // exec(`unzip ${path} -d ${path.replace(".zip", "")}`);
      // fs.unlinkSync(path);
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

  async sortFiles(files, all) {
    if (!files) return;
    if (!all)
      files = files.filter((file) => file.name.match(new RegExp(config.regEx)));
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
const { exec } = require("child_process");

var argv = require("yargs/yargs")(process.argv.slice(2))
  .usage("Usage: $0 <Blatt> <Prio> [Options]")
  .alias("a", "all")
  .boolean("a")
  .describe("a", "Alle Abgaben berücksichtigen")
  .command(
    "$0 <Blatt> <Prio>",
    "Abgaben verteilen und herunterladen",
    (yargs) => {
      yargs
        .positional("Blatt", {
          type: "number",
          describe: "Nummer des Übungsblattes",
        })
        .positional("Prio", {
          type: "number",
          describe: "Deine Nummer der Tutoren",
        });
    }
  )
  .check((argv, options) => {
    if (argv._.length > 0) {
      return "Zu viele Argumente";
    }
    // Blatt
    if (argv.Blatt == null || isNaN(argv.Blatt)) {
      return "Bitte gib ein Übungsblatt an";
    }
    if (argv.Blatt < 1 || argv.Blatt > config.maxBlatt) {
      return "Es ist kein Übungsblatt mit dieser Nummer vorhanden";
    }
    if (argv.Blatt < 10) argv.Blatt = "0" + argv.Blatt;
    // Prio
    if (argv.Prio == null || isNaN(argv.Prio)) {
      return "Bitte gib eine Priorität an";
    }
    if (argv.Prio < 1 || argv.Prio > config.tutors) {
      return "Es gibt nicht genügend Tutoren";
    }
    return true;
  })
  .help("h")
  .alias("h", "help").argv;

// All
let all = false;
if (argv.a) all = true;

let studIP = new StudIP();
(async function () {
  let files = await studIP.getAllFilesInFolder(argv.Blatt);
  let sortedFiles = await studIP.sortFiles(files, all);

  if (!sortedFiles) return;
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(length + "+" + rest);

  let download = sortedFiles.slice(
    (argv.Prio - 1) * length,
    (argv.Prio - 1) * length + length
  );
  for (i = 0; i < rest; i++) {
    if (argv.Prio == i) {
      download.push(sortedFiles[sortedFiles.length - 1 - rest + i]);
    }
  }
  await studIP.downloadFiles(download, argv.Blatt);
})();
