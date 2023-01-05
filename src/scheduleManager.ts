import fs from "fs";
import path from "path";
import crypto from "crypto";
import puppeteer, { CustomError } from "puppeteer";
import LZString from "lz-string";

import * as dateHelpers from "./dateHelpers";
import { AdminRequestResponseReturn, AdminRequestResponseStatus } from './admin';

interface CompressedSchedule {
    compressedHTML: string;
    updated: string;
}

interface Lesson {
    guidId: string;
    texts: string[];
    timeStart: string;
    timeEnd: string;
    dayOfWeekNumber: number;
    blockName: string;
}

interface LessonInfo {
    lessonInfo: Lesson[];
    updated: string;
}

interface UserSchedule {
    password: string;
    salt: string;
    weeks: { [week: string]: [CompressedSchedule, LessonInfo] };
}

interface UserScheduleFile {
    password: string;
    salt: string;
    weeks: string;
}

export interface Schedule {
    html: string;
    updated: string;
}

export enum CachedScheduleStatus {
    OldLogin,
    NoCache,
    UnknownFail,
    Success
}

export interface CachedScheduleReturn {
    status: CachedScheduleStatus;
    schedule?: Schedule;
}

export interface LessonInfoReturn {
    status: CachedScheduleStatus;
    weeks?: { [week: string]: LessonInfo };
}

export enum UpdatedScheduleStatus {
    WrongLogin,
    ServiceWindow,
    UnknownFail,
    Success,
    NoRequest,
    OnlyCached
}

export interface UpdatedScheduleReturn {
    status: UpdatedScheduleStatus;
    weeks?: { [week: string]: Schedule };
    missingWeeks: string[];
}

export interface ScrapeScheduleReturn {
    status: UpdatedScheduleStatus;
    weeks?: { [week: string]: [CompressedSchedule, LessonInfo] };
}

const schedules: { [name: string]: UserSchedule } = {};
const scrapePromises: { [name: string]: Promise<ScrapeScheduleReturn> } = {};

const scheduleCacheFolder = path.join(__dirname, "..", "cache", "users");

for (let user of fs.readdirSync(scheduleCacheFolder)) {
    let userScheduleFile: UserScheduleFile = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "cache", "users", user)).toString());
    let userSchedule: UserSchedule = { password: userScheduleFile.password, salt: userScheduleFile.salt, weeks: JSON.parse(userScheduleFile.weeks) };
    schedules[user.replace(".json", "")] = userSchedule;
}

export function getLessonInfos(name: string, weeks: string[]): LessonInfoReturn {
    if (!(name in schedules)) {
        return { status: CachedScheduleStatus.NoCache };
    }

    let status: CachedScheduleStatus = CachedScheduleStatus.Success;
    let returnWeeks: { [week: string]: LessonInfo } = {};

    for (let week of weeks) {
        if (!(week in schedules[name].weeks)) {
            status = CachedScheduleStatus.NoCache;
        } else {
            returnWeeks[week] = { updated: schedules[name].weeks[week][1].updated, lessonInfo: schedules[name].weeks[week][1].lessonInfo };
        }
    }

    return { status: status, weeks: returnWeeks };
}

export function getCachedSchedule(name: string, password: string, week: string): CachedScheduleReturn {
    if (!(name in schedules)) {
        return { status: CachedScheduleStatus.NoCache };
    }

    if (!password || !schedules[name].salt) {
        return { status: CachedScheduleStatus.OldLogin };
    }

    if (sha512salt(password, schedules[name].salt) !== schedules[name].password) {
        return { status: CachedScheduleStatus.OldLogin };
    }

    if (!(week in schedules[name].weeks)) {
        return { status: CachedScheduleStatus.NoCache };
    }

    let html = LZString.decompressFromBase64(schedules[name].weeks[week][0].compressedHTML);
    let updated = schedules[name].weeks[week][0].updated;

    if (html) {
        return { status: CachedScheduleStatus.Success, schedule: { html: html, updated: updated } };
    } else {
        return { status: CachedScheduleStatus.UnknownFail };
    }
}

export async function getSchedules(name: string, password: string, weeks: string[], week: string, useOnlyCached: boolean): Promise<UpdatedScheduleReturn> {
    let weeksToScrape: string[] = [];
    let cachedWeeks: string[] = [];

    if (!(name in schedules)) {
        weeksToScrape = weeks;
    } else if (!password || !schedules[name].salt || sha512salt(password, schedules[name].salt) !== schedules[name].password) {
        weeksToScrape = weeks;
    } else {
        for (let w of weeks) {
            if (!(w in schedules[name].weeks)) {
                weeksToScrape.push(w);
                continue;
            }

            let updatedDate = new Date(schedules[name].weeks[w][0].updated);
            if (!dateHelpers.isToday(updatedDate) && !useOnlyCached) {
                weeksToScrape.push(w);
                continue;
            }

            cachedWeeks.push(w);
        }
    }

    if (!(name in scrapePromises) && !useOnlyCached) {
        scrapePromises[name] = scrapeWeeksAttempts(name, password, weeksToScrape);
    }

    let missingWeeks: string[] = weeks;
    if (!weeksToScrape.includes(week)) {
        let ind = missingWeeks.indexOf(week);
        if (ind !== -1) {
            missingWeeks.splice(ind, 1);
        }
    }

    let returnWeeks: { [week: string]: Schedule } = {};
    let returnStatus: UpdatedScheduleStatus = UpdatedScheduleStatus.Success;

    for (let w of cachedWeeks) {
        let cachedWeek = getCachedSchedule(name, password, w);
        if (cachedWeek.status === CachedScheduleStatus.Success && cachedWeek.schedule) {
            returnWeeks[w] = { html: cachedWeek.schedule.html, updated: cachedWeek.schedule.updated };
        }
    }

    if (!useOnlyCached) {
        let scrapedWeeks = await scrapePromises[name];
        delete scrapePromises[name];

        if (scrapedWeeks.status === UpdatedScheduleStatus.ServiceWindow) {
            returnStatus = UpdatedScheduleStatus.ServiceWindow;
        } else if (scrapedWeeks.status === UpdatedScheduleStatus.WrongLogin) {
            returnStatus = UpdatedScheduleStatus.WrongLogin;
        } else if (scrapedWeeks.status === UpdatedScheduleStatus.Success && scrapedWeeks.weeks) {
            for (let w in scrapedWeeks.weeks) {
                let html = LZString.decompressFromBase64(scrapedWeeks.weeks[w][0].compressedHTML);
                if (html) {
                    returnWeeks[w] = { html: html, updated: scrapedWeeks.weeks[w][0].updated };
                } else {
                    returnStatus = UpdatedScheduleStatus.UnknownFail;
                    break;
                }
            }
        } else if (scrapedWeeks.status === UpdatedScheduleStatus.UnknownFail) {
            returnStatus = UpdatedScheduleStatus.UnknownFail;
        }
    } else {
        returnStatus = UpdatedScheduleStatus.OnlyCached;
    }

    return { status: returnStatus, missingWeeks: missingWeeks, weeks: returnWeeks };
}

const delay = (seconds: number) => { return new Promise((resolve) => setTimeout(resolve, seconds * 1000)) };

async function scrapeWeeksAttempts(name: string, password: string, weeks: string[]): Promise<ScrapeScheduleReturn> {
    if (weeks.length === 0) {
        return { status: UpdatedScheduleStatus.NoRequest };
    }
    let done = true;
    for (let attempt: number = 0; attempt < 3; attempt++) {
        let newSchedules: ScrapeScheduleReturn = await scrapeSchedules(name, password, weeks).catch(
            (err): ScrapeScheduleReturn => {
                console.error(err);
                return { status: UpdatedScheduleStatus.UnknownFail };
            });

        switch (newSchedules.status) {
            case UpdatedScheduleStatus.ServiceWindow:
                break;
            case UpdatedScheduleStatus.WrongLogin:
                break;
            case UpdatedScheduleStatus.UnknownFail:
                done = false;
                break;
            case UpdatedScheduleStatus.Success:
                break;
        }

        if (done) {
            if (newSchedules.weeks) {
                let salt = generateRandomString(512);
                let hash = sha512salt(password, salt);
                if (!schedules[name]) {
                    schedules[name] = { password: hash, salt: salt, weeks: {} };
                } else {
                    schedules[name].password = hash;
                    schedules[name].salt = salt;
                }

                for (let w in newSchedules.weeks) {
                    schedules[name].weeks[w] = [
                        { compressedHTML: newSchedules.weeks[w][0].compressedHTML, updated: newSchedules.weeks[w][0].updated },
                        { lessonInfo: newSchedules.weeks[w][1].lessonInfo, updated: newSchedules.weeks[w][1].updated }
                    ];
                }

                let userScheduleFile: UserScheduleFile = { password: schedules[name].password, salt: schedules[name].salt, weeks: JSON.stringify(schedules[name].weeks) }

                fs.writeFile(path.join(__dirname, "..", "cache", "users", name + ".json"), JSON.stringify(userScheduleFile), function (err) {
                    if (err) {
                        console.error(err);
                    }
                });
            }

            return newSchedules;
        }

        await delay(5);
    }

    return { status: UpdatedScheduleStatus.UnknownFail };
}

async function scrapeSchedules(name: string, password: string, weeks: string[]): Promise<ScrapeScheduleReturn> {
    let browser: puppeteer.Browser | null = null;
    let scrapeReturn: ScrapeScheduleReturn | null = null;

    try {
        browser = await puppeteer.launch({ headless: true });
        let page = await browser.newPage();

        await page.setRequestInterception(true);
        page.on('request', (req) => {
            if (req.resourceType() == "image" || req.resourceType() == "stylesheet" || req.resourceType() == "font") {
                req.abort();
            } else {
                req.continue();
            }

        });


        await page.goto("https://fnsservicesso1.stockholm.se/sso-ng/saml-2.0/authenticate?customer=https://login001.stockholm.se&targetsystem=TimetableViewer");

        await page.setJavaScriptEnabled(false);

        await page.waitForSelector("a.btn:nth-child(1)");
        await page.click("a.btn:nth-child(1)");

        await page.waitForSelector(".beta");
        await page.click(".beta");

        await page.waitForSelector("#user");
        await page.type("#user", name);

        await page.waitForSelector("#password");
        await page.type("#password", password);

        await page.setJavaScriptEnabled(true);

        await page.waitForSelector("button.btn");
        await page.click("button.btn");

        const logged_in_or_error = "\
    window.location.href === 'https://fns.stockholm.se/ng/timetable/timetable-viewer/fns.stockholm.se/' || \
    (document.querySelector('body > h1') !== null && document.body.innerHTML.indexOf('Skolplattformen - servicefönster') >= 0) ||\
    document.querySelector('.beta') !== null || \
    window.location.href === 'https://start.stockholm/forskola-skola/' || \
    window.location.href.includes('login.jsp')";

        await page.waitForFunction(logged_in_or_error);

        if (await page.evaluate(() => window.location.href === "https://start.stockholm/forskola-skola/")) {
            await browser.close();
            return { status: UpdatedScheduleStatus.UnknownFail };
        }

        if (await page.evaluate(() => document.body.innerHTML.indexOf("Skolplattformen - servicefönster") >= 0)) {
            await browser.close();
            return { status: UpdatedScheduleStatus.ServiceWindow };
        }

        if (await page.evaluate(() => window.location.href.includes("login.jsp"))) {
            await browser.close();

            return { status: UpdatedScheduleStatus.WrongLogin };
        }

        let lastLessonInfo: Lesson[] = [];
        page.on('response', (res) => {
            if (res.url().endsWith("/ng/api/render/timetable")) {
                res.json().then(json => {
                    lastLessonInfo = json.data.lessonInfo;
                })
            }
        });

        await page.goto("https://fns.stockholm.se/ng/portal/start/timetable/timetable-viewer/fns.stockholm.se/");

        await page.waitForResponse("https://fns.stockholm.se/ng/api/render/timetable");
        await page.waitForSelector("#timetableElement");

        scrapeReturn = { status: UpdatedScheduleStatus.Success, weeks: {} };

        for (let week of weeks) {
            await page.waitForSelector("input");
            let year = new Date().getFullYear();
            let alreadyCorrect = await page.evaluate((week, year): boolean => {
                let input = document.querySelector("input");
                if (input) {
                    return input.value === `v.${week}, ${year}`;
                }
                return false;
            }, week, year);

            if (!alreadyCorrect) {
                let oldSvg: string = await page.evaluate(() => {
                    let svg = document.querySelector("#timetableElement > svg");
                    return (svg ? svg.innerHTML : "");
                });

                await delay(0.5);

                await page.evaluate((weekText: string) => {
                    let inp = document.querySelector("input");
                    if (inp) {
                        inp.value = "";
                    }
                });
                await page.focus("input");
                await page.type("input", `v.${week}, ${year}`);
                await page.focus("input");
                await page.keyboard.press("Enter");

                //await page.waitForResponse("https://fns.stockholm.se/ng/api/get/timetable/render/key");
                //await page.waitForResponse("https://fns.stockholm.se/ng/api/render/timetable");

                await page.waitForFunction((oldSvg: string) => {
                    let svg = document.querySelector("#timetableElement > svg");
                    return svg && svg.innerHTML !== oldSvg;
                }, {}, oldSvg);
            }

            var html = await page.evaluate((): string => {
                let schedule = document.querySelector("#timetableElement");
                if (!schedule || !schedule.parentNode) {
                    return "Hittade inte schemat";
                }
                let scheduleParent = schedule.parentNode;
                let image = scheduleParent.querySelector("img");
                if (image) {
                    let imageParent = image.parentNode;
                    if (imageParent) {
                        imageParent.removeChild(image);
                    }
                }

                let svg = scheduleParent.querySelector("svg");

                if (!svg) {
                    return "Hittade inte schema-bilden";
                }
                svg.setAttribute("width", "100%");
                svg.removeAttribute("height");
                (<HTMLElement>scheduleParent.querySelector(".w-timetable")).style.width = "100%";
                (<HTMLElement>scheduleParent.querySelector(".w-timetable")).style.height = "auto";

                let svgHTML = (<Element>scheduleParent).innerHTML;
                svgHTML = svgHTML
                    .replace(/focusable="true"/g, "")
                    .replace(/box-type="[a-zA-Z]*"/g, "")
                    .replace(/tabindex="0"/g, "")
                    .replace(/cursor: pointer;/g, "")
                    .replace(/box-id="[0-9]*"/g, "")
                    .replace(/shape-rendering="crispEdges"/g, "")
                    .replace(/\s\s+/g, " ")
                    .replace(/, /g, ",")
                    .replace(/: /g, ":")
                    .replace(/; /g, ";");

                return svgHTML;
            });

            if (!scrapeReturn.weeks) {
                scrapeReturn.weeks = {};
            }

            scrapeReturn.weeks[week] = [
                { compressedHTML: LZString.compressToBase64(html), updated: new Date().toUTCString() },
                { lessonInfo: lastLessonInfo, updated: new Date().toUTCString() }
            ];
        }
    } catch (e) {
        if (browser !== null) {
            await browser.close();
        }

        throw e;
    } finally {
        if (browser !== null) {
            await browser.close();
        }
    }

    return scrapeReturn!;
}

function sha512salt(message: string, salt: string) {
    return crypto.createHmac("sha512", salt).update(message, "utf-8").digest("hex");
}

function generateRandomString(length: number) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length);
};

export function getUserList(): AdminRequestResponseReturn {
    return { status: AdminRequestResponseStatus.Success, message: JSON.stringify(Object.keys(schedules)) };
}

export function clearAllUserCache(): AdminRequestResponseReturn {
    for (let user in schedules) {
        delete schedules[user];
        if (fs.existsSync(path.join(scheduleCacheFolder, user + ".json"))) {
            fs.rmSync(path.join(scheduleCacheFolder, user + ".json"));
        }
    }

    return { status: AdminRequestResponseStatus.Success, message: "Cleared all caches." };
}

export function clearOneUserCache(user: string): AdminRequestResponseReturn {
    if (!(user in schedules)) {
        return { status: AdminRequestResponseStatus.Unsuccessful, message: `Found no user: ${user}` };
    }

    delete schedules[user];
    if (fs.existsSync(path.join(scheduleCacheFolder, user + ".json"))) {
        fs.rmSync(path.join(scheduleCacheFolder, user + ".json"));
    }

    return { status: AdminRequestResponseStatus.Success, message: `Cleared cache of user: ${user}` };
}
