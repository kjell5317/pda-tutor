#!/usr/bin/env node

const fetch = require("node-fetch");
const { Builder, By, Key, until } = require("selenium-webdriver");
const fs = require("fs");
const { exec } = require("child_process");
const { exit } = require("process");
const validate = require("jsonschema").validate;

if (!fs.existsSync(`${__dirname}/config.json`)) {
  console.log("Please create config.json at " + __dirname);
  exit();
}
const config = require("./config.json");

var argv = require("yargs/yargs")(process.argv.slice(2))
  .strict()
  .usage("Usage: $0 <Blatt> <Prio> [Options]")
  .boolean("a")
  .alias("a", "all")
  .describe("a", "Alle Abgaben berücksichtigen")
  .boolean("u")
  .alias("u", "unzip")
  .describe("u", "Unzip richtig benannte Abgaben")
  .boolean("m")
  .alias("m", "mail")
  .describe(
    "m",
    "Gibt eine CSV-Liste mit den E-Mails von falsch benannten Dateien aus"
  )
  .boolean("l")
  .alias("l", "list")
  .describe("l", "Dateinamen auflisten ohne herunterzuladen")
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
      return "Unzipping wird nur unter MacOS unterstützt";
    }
    if (argv.u && argv.a) {
      return "--unzip und --all können nicht zusammen benutzt werden";
    }
    if (argv.u && argv.l) {
      return "--unzip und --list können nicht zusammen benutzt werden";
    }
    if (argv.m && argv.a) {
      return "--mail und --all können nicht zusammen benutzt werden";
    }
    // Blatt
    if (argv.Blatt == null || isNaN(argv.Blatt)) {
      return "Bitte gib ein Übungsblatt an";
    }
    if (argv.Blatt < 1 || argv.Blatt > Object.keys(config.folder_id).length) {
      return "Es ist kein Übungsblatt mit dieser Nummer vorhanden";
    }
    if (argv.Blatt < 10) {
      argv.Blatt = "0" + argv.Blatt;
    }
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

const schema = {
  type: "object",
  properties: {
    stud_ip: {
      type: "object",
      properties: {
        name: { type: "string", pattern: "^\\w{4}\\d{4}$" },
        password: { type: "string" },
      },
      required: ["name", "password"],
    },
    folder_id: {
      type: "object",
      minLength: 1,
      patternProperties: {
        "^.*$": { type: "string", minLength: 32, maxLength: 32 },
      },
    },
    tutors: { type: "number" },
    regEx: { type: "regex" },
    url: { type: "hostname" },
    course_id: { type: "string", minLength: 32, maxLength: 32 },
    downloadPrefix: { type: "string" },
  },
  required: [
    "stud_ip",
    "folder_id",
    "tutors",
    "regEx",
    "url",
    "course_id",
    "downloadPrefix",
  ],
};

class StudIP {
  async downloadFiles(sortedFiles, blatt) {
    if (!sortedFiles) return;
    console.info(`Lade ${sortedFiles.length} Dateien herunter...`);
    if (!fs.existsSync(`${config.downloadPrefix}/UB${blatt}`)) {
      fs.mkdirSync(`${config.downloadPrefix}/UB${blatt}`);
    }
    fs.appendFile(
      `${config.downloadPrefix}/UB${blatt}/score_${
        config.me == undefined ? "X" : config.me
      }_${blatt}.csv`,
      sortedFiles
        .map((file) =>
          file.name
            .replace(`UE${blatt}_`, "")
            .replace(".zip", "")
            .replaceAll("_", " ")
        )
        .join(";\n") + ";\n",
      "utf8",
      (err) => {
        if (err) console.log(err);
      }
    );
    for (const file of sortedFiles) {
      const path = `${config.downloadPrefix}/UB${blatt}/${file.name}`;
      const data = await this.apiRequest(`/file/${file.id}/download`, "file");
      const buffer = Buffer.from(data);
      fs.writeFile(path, buffer, "binary", (err) => {
        if (err) console.log(err);
      });

      if (argv.u) {
        exec(`open ${path}`);
        setTimeout(() => fs.unlinkSync(path), 1000);
      }
    }
  }

  async getAllFilesInFolder() {
    let driver = await new Builder().forBrowser("chrome").build();
    let ids = [];
    let result = [];
    console.log("Hole alle Datei-IDs...");
    try {
      await driver.get(
        `${config.url.replace("api", "dispatch")}course/files/index/${
          config.folder_id[argv.Blatt]
        }?cid=${config.course_id}`
      );
      try {
        await driver
          .findElement(By.css("#username"))
          .sendKeys(config.stud_ip.name);
        await driver
          .findElement(By.css("#password"))
          .sendKeys(config.stud_ip.password, Key.RETURN);
      } catch (err) {
        console.log("Du bist bereits angemeldet");
      }
      await driver.wait(until.elementLocated(By.css("tbody.files tr")), 5000);
      let files = await driver.findElements(By.css("tbody.files tr"));
      for (const file of files) {
        ids.push((await file.getAttribute("id")).replace("fileref_", ""));
      }
    } catch (err) {
      console.log("Es sind keine Dateien in diesem Ordner vorhanden");
      return;
    } finally {
      await driver.quit();
    }
    console.log(`Hole die Metadaten von ${ids.length} Dateien...`);
    for (const id of ids) {
      result.push(await this.apiRequest(`file/${id}`));
    }
    return result;
  }

  async sortFiles(files) {
    if (!files) return;
    if (!argv.a) {
      let wrong = files
        .filter(
          (file) =>
            !file.name.match(
              new RegExp(config.regEx) // .replace("\\d{2}", argv.Blatt)
            )
        )
        .map((file) => file.user_id)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (argv.m) {
        if (wrong.length > 0) console.log("Studenten mit falscher Abgabe:");
        let output = "";
        for (const user of wrong) {
          output += (await this.apiRequest(`user/${user}`)).email + ";";
        }
        console.log(output);
      }
      files = files.filter(
        (file) => file.name.match(new RegExp(config.regEx)) // .replace("\\d{2}", argv.Blatt)
      );
    }
    let authors = {};
    let sortedFiles = {};
    for (const file of files) {
      if (file.user_id in authors && authors[file.user_id] > file.mkdate) {
        continue;
      }
      authors[file.user_id] = file.mkdate;
      sortedFiles[file.user_id] = file;
    }
    sortedFiles = Object.values(sortedFiles);
    console.log(
      argv.a
        ? `${sortedFiles.length} Dateien von verschiedenen Autoren gefunden`
        : `${sortedFiles.length} korrekt benannten Dateien von verschiedenen Autoren gefunden`
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
      console.log("Stud.IP API Error");
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

(async function () {
  let res = validate(config, schema);
  if (!res.valid) {
    console.log(res.errors);
    console.log("config.json ist ungültig");
    exit();
  }

  let studIP = new StudIP();
  let files = await studIP.getAllFilesInFolder();
  let sortedFiles = await studIP.sortFiles(files);

  if (!sortedFiles) return;
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(
    `${length} Datei(en) für jeden Tutor und ${rest} Datei(en) für die ersten Tutoren`
  );

  let download = sortedFiles.slice(
    (argv.Prio - 1) * length,
    (argv.Prio - 1) * length + length
  );
  for (let i = 1; i <= rest; i++) {
    if (argv.Prio == i) {
      download.push(sortedFiles[sortedFiles.length - 1 - rest + i]);
    }
  }
  if (argv.l) {
    console.log("\t" + download.map((file) => file.name).join("\n\t"));
  } else {
    await studIP.downloadFiles(download, argv.Blatt);
  }
})();
