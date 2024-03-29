import fs from "fs";
import path from "path";

import { getLessonInfos } from './scheduleManager';
import { generateRandomString } from "./security";

var mapping: { [name: string]: string } = {};
var reverseMapping: { [key: string]: string } = {};

const fileWeeks: { [filePath: string]: string[] } = {};

if (fs.existsSync(path.join(__dirname, "..", "cache", "export-mapping.json"))) {
    let map = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cache", "export-mapping.json")).toString());
    mapping = map.mapping;
    reverseMapping = map.reverseMapping;
}

function foldLine(line: string) {
    const parts = [];
    let length = 75;
    while (line.length > length) {
        parts.push(line.slice(0, length));
        line = line.slice(length);
        length = 74;
    }
    parts.push(line);
    return parts.join('\r\n\t');
}

function getDateOfISOWeek(w: number, y: number): Date {
    var simple = new Date(y, 0, 1 + (w - 1) * 7);
    var dow = simple.getDay();
    var ISOweekStart = simple;
    if (dow <= 4)
        ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
    else
        ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());
    return ISOweekStart;
}

export function getPathToICalFile(key: string, weeks: string[]): string {
    if (!(key in reverseMapping)) {
        return "";
    }

    let name = reverseMapping[key];

    let lessonInfo = getLessonInfos(name, weeks);

    if (!("weeks" in lessonInfo)) {
        return "";
    }

    let ical: string = `BEGIN:VCALENDAR
VERSION:2.0
METHOD:PUBLISH
X-PUBLISHED-TTL:PT20M
PRODID:-//snabbaschemat.se//Schedules
X-WR-CALNAME:Snabba Schemat Calendar Title
NAME:Snabba Schemat Calendar Title
CALSCALE:GREGORIAN
`;

    for (let week in lessonInfo.weeks) {
	if (lessonInfo.weeks[week].lessonInfo === null) {
	    continue; 
	}

        for (let lesson of lessonInfo.weeks[week].lessonInfo) {
            let date = getDateOfISOWeek(Number.parseInt(week), new Date().getFullYear());
            date.setDate(date.getDate() + lesson.dayOfWeekNumber);

            ical += `BEGIN:VEVENT
DTSTAMP:${new Date().toISOString().replace(/[:\.-]/g, "").slice(0, 15)}
UID:${lesson.guidId}--${date.toISOString().replace(/[:\.-]/g, "").slice(0, 8)}--${lesson.timeStart.replace(/:/g, "")}@snabbaschemat.se
DTSTART;TZID=Europe/Stockholm;VALUE=DATE-TIME:${date.toISOString().replace(/[:\.-]/g, "").slice(0, 8)}T${lesson.timeStart.replace(/:/g, "")}Z
DTEND;TZID=Europe/Stockholm;VALUE=DATE-TIME:${date.toISOString().replace(/[:\.-]/g, "").slice(0, 8)}T${lesson.timeEnd.replace(/:/g, "")}Z
SUMMARY:${lesson.texts[0]}
DESCRIPTION:${lesson.texts[0]} ${lesson.texts[1] === undefined || lesson.texts[1] === "" ? "" : "-"} ${lesson.texts[1]}
LOCATION:${lesson.texts[2]}
END:VEVENT
`;
        }
    }

    ical += "END:VCALENDAR\n";

    ical = ical.replace(/,/g, "\\,");

    const parts: string[] = [];
    for (let part of ical.split("\n")) {
        parts.push(foldLine(part));
    }
    ical = parts.join("\r\n") + "\r\n";

    if (!fs.existsSync(path.join(__dirname, "..", "temp", "export-ics"))) {
        fs.mkdirSync(path.join(__dirname, "..", "temp", "export-ics"), { recursive: true });
    }

    let pathToFile: string = path.join(__dirname, "..", "temp", "export-ics", key + ".ics");
    if (fs.existsSync(pathToFile) && fs.readFileSync(pathToFile).toString() === ical) {
        return pathToFile;
    }

    fs.writeFileSync(pathToFile, ical);
    fileWeeks[pathToFile] = weeks;
    return pathToFile;
}

export function getKey(name: string): string {
    if (name in mapping) {
        return mapping[name];
    }

    return "";
}

export function createNewExport(name: string) {
    if (name in mapping) {
        disableExport(name);
    }

    mapping[name] = generateRandomString(96);
    reverseMapping[mapping[name]] = name;

    fs.writeFileSync(path.join(__dirname, "..", "cache", "export-mapping.json"), JSON.stringify({ mapping: mapping, reverseMapping: reverseMapping}));
}

export function disableExport(name: string) {
    if (name in mapping) {
        delete reverseMapping[mapping[name]];
        delete mapping[name];
    }

    fs.writeFileSync(path.join(__dirname, "..", "cache", "export-mapping.json"), JSON.stringify({ mapping: mapping, reverseMapping: reverseMapping}));
}
