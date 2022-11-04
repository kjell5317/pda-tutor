# CLI PDA-Tutor

## Installation

1. Run `git clone https://github.com/kjell5317/cli-pda_tutor`
1. Install [Nodejs](https://nodejs.org/en/download/)
1. Run `npm i` to install dependencies
1. Install [Chrome](https://www.google.de/google_chrome/download)
1. Install [Chromedriver](http://chromedriver.storage.googleapis.com/index.html) and add it to your PATH
1. Configure `config.json`
1. Run `npm install -g .` to make the `pdaTutor` globally available
1. Run `node .` or `pdaTutor` to see all available commands
1. Run `pdaTutor` followed by the number of the current exercise and your section number from 0 - max number of tutors. Example: `pdaTutor 1 1`

*Note: -u / --unzip is only supported for MacOS*

## Add Chromedriver to your PATH (Windows)

1. Create directory `C:\bin`
1. Copy chromedriver.exe to `C:\bin`
1. Hit WIN+R and run `sysdm.cpl`
1. Edit Path under "Erweitert" -> "Umgebungsvariablen"
1. Double click Path under "Benutzervariablen"
1. Add `C:\bin` (DO NOT delete anything else)
