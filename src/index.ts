#!/usr/bin/env node

const config = require("./config.json");

import fetch from "node-fetch";
import { Builder, By, Key, until } from "selenium-webdriver";
import { existsSync, mkdirSync, unlinkSync, writeFile } from "fs";
import { exit } from "process";
import { exec } from "child_process";
const validate = require("jsonschema").validate;

var argv = require("yargs/yargs")(process.argv.slice(2))
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
    "Gibt eine CSV-Liste mit den E-Mails von falsch benannten Dateien aus"
  )
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
  .check((argv) => {
    if (argv._.length > 0) {
      return "Zu viele Argumente";
    }
    if (process.platform !== "darwin" && argv.u) {
      return "Unzipping wird nur unter MacOS unterstützt";
    }
    if (argv.u && argv.a) {
      return "--unzip und --all können nicht zusammen benutzt werden";
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

interface File {
  name: string;
  mkdate: number;
  user_id: string;
  id: string;
}

interface User {
  email: string;
}

class StudIP {
  async downloadFiles(sortedFiles: File[], blatt: number) {
    if (!sortedFiles) return;
    console.info(`Downloading ${sortedFiles.length} files...`);
    if (!existsSync(`${config.downloadPrefix}/UB${blatt}`)) {
      mkdirSync(`${config.downloadPrefix}/UB${blatt}`);
    }
    writeFile(
      `${config.downloadPrefix}/UB${blatt}/score_X_${blatt}.csv`,
      sortedFiles
        .map((file) =>
          file.name
            .replace(`UE${blatt}_`, "")
            .replace(".zip", "")
            .replaceAll("_", " ")
        )
        .join(";\n") + ";",
      "utf8",
      (err) => {
        if (err) console.log(err);
      }
    );
    for (const file of sortedFiles) {
      const path = `${config.downloadPrefix}/UB${blatt}/${file.name}`;
      const data = await this.downloadRequest(file.id);
      const buffer = Buffer.from(data);
      writeFile(path, buffer, "binary", (err) => {
        if (err) console.log(err);
      });

      if (argv.u) {
        exec(`open ${path}`);
        setTimeout(() => unlinkSync(path), 1000);
      }
    }
  }

  async getAllFilesInFolder(): Promise<File[]> {
    let driver = await new Builder().forBrowser("chrome").build();
    let ids = [];
    let result = [];
    console.log("Getting all file IDs in folder...");
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
        console.log("You are already logged in");
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
    console.log(`Getting metadata of ${ids.length} files...`);
    for (const id of ids) {
      result.push(await this.fileRequest(`file/${id}`));
    }
    return result;
  }

  async sortFiles(files: File[]): Promise<File[]> {
    if (!files) return;
    if (!argv.a) {
      let wrong = files
        .filter(
          (file) =>
            !file.name.match(
              new RegExp(config.regEx.replace("\\d{2}", argv.Blatt))
            )
        )
        .map((file) => file.user_id)
        .filter((v, i, a) => a.indexOf(v) === i);
      if (wrong.length > 0) console.log("Studenten mit falscher Abgabe:");
      let output: string;
      for (const user of wrong) {
        output += (await this.userRequest(user)).email + ";";
      }

      files = files.filter(
        (file) => file.name.match(new RegExp(config.regEx.replace("\\d{2}", argv.Blatt)))
      );
    }
    let authors = {};
    let sortedFiles = {};
    for (const file of files) {
      if (file.user_id in authors && authors[file.user_id] <= file.mkdate)
        continue;
      authors[file.user_id] = file.mkdate;
      sortedFiles[file.user_id] = file;
    }
    let sortedFilesArr: File[] = Object.values(sortedFiles);
    console.log(
      argv.a
        ? `${sortedFilesArr.length} unique files found`
        : `${sortedFilesArr.length} unique und correct named files found`
    );

    return sortedFilesArr;
  }

  async fileRequest(file: string): Promise<File> {
    let response = await fetch(`${config.url}/file/${file}`, {
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
    return await response.json();
  }

  async userRequest(user: string): Promise<User> {
    let response = await fetch(`${config.url}/user/${user}`, {
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
    return await response.json();
  }

  async downloadRequest(file: string): Promise<ArrayBuffer> {
    let response = await fetch(`${config.url}/file/${file}/download`, {
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
    return await response.arrayBuffer();
  }
}

(async function () {
  let res = validate(config, schema);
  if (!res.valid) {
    console.log(res.errors);
    exit();
  }

  let studIP = new StudIP();
  let files = await studIP.getAllFilesInFolder();
  let sortedFiles = await studIP.sortFiles(files);

  if (!sortedFiles) return;
  let length = Math.floor(sortedFiles.length / config.tutors);
  let rest = sortedFiles.length % config.tutors;
  console.log(`${length} files for each tutor and ${rest} left files`);

  let download = sortedFiles.slice(
    (argv.Prio - 1) * length,
    (argv.Prio - 1) * length + length
  );
  for (let i = 1; i <= rest; i++) {
    if (argv.Prio == i) {
      download.push(sortedFiles[sortedFiles.length - 1 - rest + i]);
    }
  }
  await studIP.downloadFiles(download, argv.Blatt);
})();
