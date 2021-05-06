import fs from 'fs';
import path from 'path';

import puppeteer from 'puppeteer';

interface FoodWeek {
    html: string;
    updated: string;
}

const foodFilePath: string = path.join(__dirname, "..", "cache", "food.json");

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
    const browser = await puppeteer.launch();
    const page = await browser.newPage();
    await page.goto('https://sodexo.mashie.com/public/app/St%20Eriks%20gymnasium/6639b607?country=se');

    await page.waitForSelector('#app-page > div.panel-group');

    let foodWeekHTMLs: { [week: string]: string } = await page.evaluate((weeks: string[]): { [week: string]: string } => {
        let weekHolder = document.querySelector("#app-page > div.panel-group");

        if (!weekHolder) {
            return {};
        }

        let weeksHTML: { [week: string]: string } = {};
        let thisWeek: string = "";

        let i = 0;
        let extracted = document.createElement("tr");
        while (weekHolder.childElementCount > i) {
            if (weekHolder.children[i].nodeName === "H4" && Object.keys(weeksHTML).length === weeks.length) {
                break;
            }

            if (weekHolder.children[i].nodeName === "H4") {
                if (thisWeek) {
                    weeksHTML[thisWeek] = "<table>" + extracted.outerHTML + "</table>";
                    extracted = document.createElement("tr");
                    thisWeek = "";
                }

                let mat = (weekHolder.children[i] as HTMLElement).innerText.match(/[\d]+/g);
                if (mat) {
                    let week = mat[0];
                    if (weeks.includes(week)) {
                        thisWeek = week;
                    }
                }
            } else if (weekHolder.children[i].nodeName === "DIV") {
                if (thisWeek) {
                    let holder = document.createElement("td");

                    let dateDay = document.createElement("h3");
                    dateDay.innerText = (weekHolder.children[i].children[0] as HTMLElement).innerText;
                    holder.appendChild(dateDay);

                    let numberMatch = dateDay.innerText.match(/[\d]+/g);
                    if (!numberMatch) {
                        thisWeek = "";
                    } else {
                        holder.id = `day_${('0' + numberMatch[0]).slice(-2)}`;

                        for (let j = 0; j < weekHolder.children[i].children[1].childElementCount; j++) {
                            let category = document.createElement("strong");
                            category.innerText = (weekHolder.children[i].children[1].children[j].children[1] as HTMLElement).innerText;
                            holder.appendChild(category);

                            let food = document.createElement("p");
                            food.innerText = (weekHolder.children[i].children[1].children[j].children[2] as HTMLElement).innerText;
                            food.style.marginTop = "4px";
                            food.style.marginBottom = "12px";
                            holder.appendChild(food);
                        }

                        extracted.appendChild(holder);
                    }
                }
            }

            i++;
        }

        if (thisWeek) {
            weeksHTML[thisWeek] = "<table>" + extracted.outerHTML + "</table>";
        }

        return weeksHTML;
    }, weeks);

    await browser.close();

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