import fs from 'fs';
import path from 'path';
import https from 'https';

import express, { urlencoded } from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import address from 'address';

import * as security from './security';
import * as scheduleManager from './scheduleManager';
import * as foodManager from './foodManager';
import * as dateHelper from './dateHelpers';


const HOST = address.ip();
const HTTP_PORT = 8080;
const HTTPS_PORT = 8081;

const useHTTPS: boolean = false;

const FUTURE_WEEKS = 3;

const scheduleTemplate = fs.readFileSync(path.join(__dirname, "..", "htmlsMin", "schedule.min.html").toString());

const app = express();
app.use(compression());

app.use(express.static("public"));
app.use("/bin", express.static("bin"));
app.use('/.well-known', express.static('.well-known'));

app.use(cookieParser(security.secret));
app.use(express.json());


app.post("/activate", (req, res) => {
    if (!('activationCode' in req.body)) {
        return res.sendStatus(400);
    }

    let activation = security.activateCode(req.body.activationCode);
    if (activation.status === security.ActivateCodeStatus.Success) {
        res.cookie('uuid', activation.uuid, { maxAge: 10 * 365 * 24 * 3600 * 1000, httpOnly: true, signed: true });
        return res.send(JSON.stringify({
            success: true,
            message: 'Kod aktiverad',
        }));
    } else if (activation.status === security.ActivateCodeStatus.InvalidCode) {
        return res.send(JSON.stringify({
            success: false,
            message: "Ogiltig aktiveringskod"
        }));
    }
});


app.use(security.authenticate);
app.use(security.login);

app.get("/", (req, res) => {
    res.clearCookie("color-mode");
    let week: string = dateHelper.getWeek(new Date()).toString();
    if ("week" in req.cookies) {
        week = req.cookies.week;
    }

    let schedule = scheduleTemplate.slice().toString();
    let password = security.decryptRSA(req.cookies.password);
    let cachedSchedule = scheduleManager.getCachedSchedule(req.cookies.name, password, week);

    if (cachedSchedule.status === scheduleManager.CachedScheduleStatus.NoCache) {
        schedule = schedule.replace("<!--! MESSAGE -->", "Det fanns inget sparat schema, laddar in...");
    } else if (cachedSchedule.status === scheduleManager.CachedScheduleStatus.OldLogin) {
        schedule = schedule.replace("<!--! MESSAGE -->", "Fel inloggningsuppgifter till det sparade schemat. Detta kan hända efter ett lösenordsbyte, vänter på att ladda in med det nya lösenordet...");
    } else if (cachedSchedule.status === scheduleManager.CachedScheduleStatus.Success && cachedSchedule.schedule) {
        schedule = schedule.replace("\"--SCHEDULE--\"", JSON.stringify(cachedSchedule.schedule)); //.replace(/"/g, '\\"').replace(/'/g, "\\'"));
        if (cachedSchedule.schedule) {
            if (!dateHelper.isToday(new Date(cachedSchedule.schedule.updated))) {
                schedule = schedule.replace("<!--! MESSAGE -->", "Det sparade schemat är äldre än en dag, laddar in ett uppdaterat...");
            }
        }
    } else {
        schedule = schedule.replace("<!--! MESSAGE -->", "Okänt fel vid hämtande av schema.");
    }

    if (schedule.includes("--SCHEDULE--")) {
        schedule = schedule.replace("--SCHEDULE--", "");
    }

    return res.type("html").send(schedule);
});

app.post("/schedules", async (req, res) => {
    if (!("week" in req.cookies)) {
        return res.sendStatus(400);
    }

    let weeks = [];
    let currentWeek = dateHelper.getWeek(new Date());
    for (let w = currentWeek; w <= currentWeek + FUTURE_WEEKS; w++) {
        weeks.push(w.toString());
    }

    if (!(weeks.includes(req.cookies.week))) {
        return res.sendStatus(400);
    }

    let password = security.decryptRSA(req.cookies.password);
    let schedules = await scheduleManager.getSchedules(req.cookies.name, password, weeks, req.cookies.week);

    if (schedules.status === scheduleManager.UpdatedScheduleStatus.WrongLogin) {
        res.clearCookie("name");
        res.clearCookie("password");
        return res.json({ message: "Fel inloggningsuppgifter. Du har blivit utloggad, ladda om sidan för att skriva i nya." });
    } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.ServiceWindow) {
        if (schedules.weeks) {
            let returnWeeks: { [week: string]: string } = {};
            for (let w of schedules.missingWeeks) {
                if (w in schedules.weeks) {
                    returnWeeks[w] = schedules.weeks[w].html;
                } else {
                    returnWeeks[w] = "Schemat har ett service-fönster, kan bara visa tidigare sparade scheman. När service-fönstret är över kommer nya scheman hämtas.";
                }
            }
            return res.json({ weeks: returnWeeks });
        } else {
            return res.json({ message: "Schemat har ett service-fönster, kan bara visa tidigare sparade scheman. När service-fönstret är över kommer nya scheman hämtas." });
        }
    } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.Success) {
        if (schedules.weeks) {
            return res.json({ weeks: schedules.weeks });
        }
    }

    return res.json({ message: "Okänt fel vid hämtande av scheman." });
});

app.post("/food", async (req, res) => {
    let weeks: string[] = [];
    let currentWeek = dateHelper.getWeek(new Date());
    for (let w = currentWeek; w <= currentWeek + FUTURE_WEEKS; w++) {
        weeks.push(w.toString());
    }

    let foodData = await foodManager.getFood(weeks);
    res.json({ weeks: foodData });
});



if (useHTTPS) {
    const httpRedirect = express();
    httpRedirect.all("*", (req, res) => {
        res.redirect(302, 'https://' + req.headers.host + req.url);
    });

    httpRedirect.listen(HTTP_PORT, HOST, () => {
        console.log("HTTP server is running on http://%s:%s", HOST, HTTP_PORT);
    });

    const sslServer = https.createServer({
        key: fs.readFileSync(path.join(__dirname, '..', 'cert', 'private.key')),
        cert: fs.readFileSync(path.join(__dirname, '..', 'cert', 'certificate.crt'))
    }, app);

    sslServer.listen(HTTPS_PORT, HOST, () => {
        console.log("HTTPS server is running on https://%s:%s", HOST, HTTPS_PORT);
    });
} else {
    app.listen(HTTP_PORT, HOST, () => {
        console.log("HTTP server is running on http://%s:%s", HOST, HTTP_PORT);
    });
}