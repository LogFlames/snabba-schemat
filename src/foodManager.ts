import fs from 'fs';
import path from 'path';

import puppeteer from 'puppeteer';
import { AdminRequestResponseReturn, AdminRequestResponseStatus } from './admin';

interface FoodWeek {
    html: string;
    updated: string;
}

const foodFilePath: string = path.join(__dirname, "..", "cache", "food.json");
const foodConfigFilePath: string = path.join(__dirname, "..", "private", "foodConfig.json");

var foodLink: string = "";
loadFoodLink();

var foods: { [week: string]: FoodWeek } = {};
if (fs.existsSync(foodFilePath)) {
    foods = JSON.parse(fs.readFileSync(foodFilePath).toString());
}

export async function getFood(weeks: string[]): Promise<{ [week: string]: FoodWeek }> {
    let weeksToFetch: string[] = [];
    for (let week of weeks) {
        if (!(week in foods)) {
            weeksToFetch.push(week);
        }
    }

    // Since the cost of fetching aditional weeks is basically none, update every week if one has to be updated
    if (weeksToFetch.length > 0) {
        weeksToFetch = weeks;
    }

    if (weeksToFetch.length > 0) {
        await scrapeFood(weeksToFetch).catch((err) => {
            console.log(err);
        });
    }

    let returnWeeks: { [week: string]: FoodWeek } = {};
    for (let week of weeks) {
        returnWeeks[week] = foods[week];
    }

    return returnWeeks;
}

async function scrapeFood(weeks: string[]) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    await page.setRequestInterception(true);
    page.on("request", (req) => {
        if (req.resourceType() == "image" || req.resourceType() == "stylesheet" || req.resourceType() == "font" || req.resourceType() == "script") {
            req.abort();
        } else {
            req.continue();
        }
    });

    await page.goto(foodLink);

    await page.waitForSelector('#app-page > div.panel-group');

    let foodWeekTexts: { [week: string]: string[][] } = await page.evaluate((weeks: string[]): { [week: string]: string[][] } => {
        let weekHolder = document.querySelector("#app-page > div.panel-group");

        if (!weekHolder) {
            return {};
        }

        let weeksText: { [week: string]: string[][] } = {};
        let thisWeek: string = "";

        let i = 0;
        while (weekHolder.childElementCount > i) {
            if (weekHolder.children[i].nodeName === "H4" && Object.keys(weeksText).length >= weeks.length) {
                break;
            }

            if (weekHolder.children[i].nodeName === "H4") {
                let mat = (weekHolder.children[i] as HTMLElement).innerText.match(/[\d]+/g);
                if (mat) {
                    let week = mat[0];
                    if (weeks.includes(week)) {
                        thisWeek = week;
                        weeksText[thisWeek] = [];
                    } else {
                        thisWeek = "";
                    }
                }
            } else if (weekHolder.children[i].nodeName === "DIV") {
                if (thisWeek) {
                    let holderList = [];

                    let dateDay = document.createElement("h3");
                    dateDay.innerText = (weekHolder.children[i].children[0] as HTMLElement).innerText;
                    holderList.push(dateDay.outerHTML);

                    let numberMatch = dateDay.innerText.match(/[\d]+/g);
                    if (!numberMatch) {
                        thisWeek = "";
                    } else {
                        for (let j = 0; j < weekHolder.children[i].children[1].childElementCount; j++) {
                            let prevWasStrong = false;

                            for (let k = 0; k < weekHolder.children[i].children[1].children[j].childElementCount; k++) {
                                let nodeName: string = weekHolder.children[i].children[1].children[j].children[k].nodeName;
                                if (nodeName === "STRONG") {
                                    prevWasStrong = true;
                                    let category = document.createElement("strong");
                                    category.innerText = (weekHolder.children[i].children[1].children[j].children[k] as HTMLElement).innerText;
                                    holderList.push(category.outerHTML);
                                } else if (nodeName === "DIV" && prevWasStrong) {
                                    prevWasStrong = false;

                                    let food = document.createElement("p");
                                    food.innerText = (weekHolder.children[i].children[1].children[j].children[k] as HTMLElement).innerText;
                                    food.style.marginTop = "4px";
                                    food.style.marginBottom = "12px";

                                    if (food.innerText === "") {
                                        continue;
                                    }
                                    holderList.push(food.outerHTML);
                                }
                            }
                        }

                        weeksText[thisWeek].push(holderList);
                    }
                }
            }

            i++;
        }

        return weeksText;
    }, weeks);

    await browser.close();

    let foodWeekHTMLs: { [week: string]: string } = {};

    for (let week in foodWeekTexts) {
        foodWeekHTMLs[week] = "<table>";
        let maxLength = Math.max(...(foodWeekTexts[week].map(el => el.length)));
        for (let j = 0; j < maxLength; j++) {
            let row = "<tr>";
            for (let i = 0; i < foodWeekTexts[week].length; i++) {
                if (j >= foodWeekTexts[week][i].length) {
                    row += "<td></td>";
                } else {
                    row += "<td>" + foodWeekTexts[week][i][j] + "</td>";
                }
            }
            row += "</tr>";
            foodWeekHTMLs[week] += row;
        }
        foodWeekHTMLs[week] += "</table>";
        foodWeekHTMLs[week] = foodWeekHTMLs[week].replace(/Kökets gröna 1/g, "Kökets gröna");
    }

    let now = new Date().toUTCString();
    for (let week of weeks) {
        if (week in foodWeekHTMLs) {
            foods[week] = { html: foodWeekHTMLs[week], updated: now };
        } else if (!(week in foods)) {
            foods[week] = { html: `Kunde inte hämta matsedeln för vecka ${week}`, updated: now };
        }
    }

    fs.writeFileSync(foodFilePath, JSON.stringify(foods));
}

export function clearCachedFoods(): AdminRequestResponseReturn {
    foods = {};
    if (fs.existsSync(foodFilePath)) {
        fs.rmSync(foodFilePath);
    }

    return { status: AdminRequestResponseStatus.Success };
}

export function updateFoodLink(newFoodLink: string): AdminRequestResponseReturn {
    foodLink = newFoodLink;
    fs.writeFileSync(foodConfigFilePath, JSON.stringify({ foodLink: foodLink }, null, 2));

    return { status: AdminRequestResponseStatus.Success, message: "Food link changed, you now probably want to clear the cached food." };
}

export function getFoodLink(): string {
    return foodLink;
}

function loadFoodLink() {
    foodLink = JSON.parse(fs.readFileSync(foodConfigFilePath).toString()).foodLink;
}