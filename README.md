# CLI PDA-Tutor

## Installation

1. Install [Nodejs](https://nodejs.org/en/download/)
1. Install [Chrome](https://www.google.de/google_chrome/download)
1. Install [Chromedriver](http://chromedriver.storage.googleapis.com/index.html) and add it to your PATH
1. Run `npx cli-pda_tutor`

### Add Chromedriver to your PATH (Windows)

1. Create directory `C:\bin`
1. Copy chromedriver.exe to `C:\bin`
1. Hit WIN+R and run `sysdm.cpl`
1. Edit Path under "Erweitert" -> "Umgebungsvariablen"
1. Double click Path under "Benutzervariablen"
1. Add `C:\bin` (DO NOT delete anything else)

## Configuration

1. Create `config.json` in the directory that your console outputs with the following content:

```json
{
  "stud_ip": {
    "name": "", // string: your username
    "password": "" // string: your password
  },
  "folder_id": {
    "01": "4e41298c8fa595b706c66g377ca1a6df", // string: go to the folder where your students upload the first assignment in your browser and copy the ID from the URL
    "02": "993ada6g5700be0607ddd1c4d052998c" // create as many IDs as there are assignments in the semester
  },
  "tutors": 8, // int: number of correcting tutors
  "regEx": "^UE\\d{2}_\\w+(\\[\\d+\\])?\\.zip$", // string: RegExp for the file name
  "url": "https://elearning.uni-oldenburg.de/api.php/", // string: your Stud.IP domain
  "course_id": "fc24089554cf8ge7d1d076f4829a2d8a", // string: the ID of your course can also be found in the URL behind cid=
  "downloadPrefix": "" // string: choose a path on your machine where the files should be downloaded to
}
```

Enter your values as described in the comments

`pdaWS2223.config.json` is an example

## Usage

Run `npx cli-pda_tutor` followed by the number of the current exercise and your section number from 0 to max number of tutors. Example: `npx cli-pda_tutor 1 1`

### Flags

* `-l` lists the files you would get but does not download them. Can not be used with `-u`
* `-m` outputs the email address of all students who hand over files with wrong names
* `-a` downloads all files, even if the name is wrong. Can not be used with `-u` or `-m`
* `-u` unzips the downloaded files automaticly. This is only supported for MacOS
