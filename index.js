#!/usr/bin/env node

class StudIP {
  async downloadFiles(sortedFiles, blatt) {
    if (!sortedFiles) return;
    console.info(`Downloading ${sortedFiles.length} files...`);
    for (const file of sortedFiles) {
      const path = `${config.downloadPrefix}/UB${blatt}/${file.name}`;
      if (!fs.existsSync(`${config.downloadPrefix}/UB${blatt}`)) {
        fs.mkdirSync(`${config.downloadPrefix}/UB${blatt}`);
      }
      const data = await this.apiRequest(`/file/${file.id}/download`, "file");
      const buffer = Buffer.from(data);
      fs.writeFile(path, buffer, "binary", () => {});

      if (argv.u) {
        await exec(`open ${path}`);
        setTimeout(() => fs.unlinkSync(path), 1000);
      }
    }
  }

  async getAllFilesInFolder(blatt) {
    let driver = await new Builder().forBrowser("chrome").build();
    let ids = [];
    let result = [];
    console.log("Getting all file IDs in folder...");
    try {
      await driver.get(
        `https://elearning.uni-oldenburg.de/dispatch.php/course/files/index/${config.folder_id[blatt]}?cid=${config.course_id}`
      );
      try {
        await driver
          .findElement(By.css("#username"))
          .sendKeys(config.stud_ip.name);
        await driver
          .findElement(By.css("#password"))
          .sendKeys(config.stud_ip.password, Key.RETURN);
      } catch (err) {
        console.log("You are already logged in");
      }
      await driver.wait(until.elementLocated(By.css("tbody.files tr")), 10000);
      let files = await driver.findElements(By.css("tbody.files tr"));
      for (const file of files) {
        ids.push((await file.getAttribute("id")).replace("fileref_", ""));
      }
    } finally {
      await driver.quit();
    }
    console.log(`Getting metadata of ${ids.length} files...`);
    for (const id of ids) {
      result.push(await this.apiRequest(`file/${id}`));
    }
    return result;
  }

  async sortFiles(files, all) {
    if (!files) return;
    if (!all) {
      let wrong = files
        .filter((file) => !file.name.match(new RegExp(config.regEx)))
        .map((file) => file.user_id)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (wrong.length > 0) console.log("Studenten mit falscher Abgabe:");
      for (const user of wrong) {
        console.log("\t" + (await this.apiRequest(`user/${user}`)).email);
      }

      files = files.filter((file) => file.name.match(new RegExp(config.regEx)));
    }
    let authors = {};
    let sortedFiles = {};
    for (const file of files) {
      if (file.user_id in authors && authors[file.user_id] <= file.mkdate)
        continue;
      authors[file.user_id] = file.mkdate;
      sortedFiles[file.user_id] = file;
    }
    sortedFiles = Object.values(sortedFiles);
    console.log(
      all
        ? `${sortedFiles.length} unique files found`
        : `${sortedFiles.length} unique und correct named files found`
    );

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

const config = require("./_config.json");

const fetch = require("node-fetch");
const { Builder, By, Key, until } = require("selenium-webdriver");
const fs = require("fs");
const exec = require("await-exec");

var argv = require("yargs/yargs")(process.argv.slice(2))
  .usage("Usage: $0 <Blatt> <Prio> [Options]")
  .boolean("a")
  .alias("a", "all")
  .describe("a", "Alle Abgaben berücksichtigen")
  .boolean("u")
  .alias("u", "unzip")
  .describe("u", "Unzip richtig benannte Abgaben")
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
    if (process.platform !== "darwin" && argv.u) {
      return "Unzipping is only supported for MacOS";
    }
    // Blatt
    if (argv.Blatt == null || isNaN(argv.Blatt)) {
      return "Bitte gib ein Übungsblatt an";
    }
    if (argv.Blatt < 1 || argv.Blatt > config.folder_id.length) {
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
if (argv.a && !argv.u) all = true;

let studIP = new StudIP();
(async function () {
  let files = await studIP.getAllFilesInFolder(argv.Blatt);
  let sortedFiles = await studIP.sortFiles(files, all);

  if (!sortedFiles) return;
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(`${length} files for each tutor and ${rest} left files`);

  let download = sortedFiles.slice(
    (argv.Prio - 1) * length,
    (argv.Prio - 1) * length + length
  );
  for (i = 1; i <= rest; i++) {
    if (argv.Prio == i) {
      download.push(sortedFiles[sortedFiles.length - 1 - rest + i]);
    }
  }
  await studIP.downloadFiles(download, argv.Blatt);
})();
