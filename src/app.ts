import fs from 'fs';
import path from 'path';
import https from 'https';

import express from 'express';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import expressRateLimit from 'express-rate-limit';
import address from 'address';
import cors from 'cors';

import * as security from './security';
import * as scheduleManager from './scheduleManager';
import * as foodManager from './foodManager';
import * as dateHelper from './dateHelpers';
import * as admin from './admin';
import * as icalExport from './icalExport';


//const HOST = address.ip();
const HOST = "127.0.0.1";
const HTTP_PORT = 8080;
const HTTPS_PORT = 8081;

const USE_HTTPS: boolean = false;
const USE_ONLY_CACHE: boolean = false;

const FUTURE_WEEKS = 3;

const scheduleTemplate = fs.readFileSync(path.join(__dirname, "..", "htmlsMin", "schedule.min.html").toString());
const shareTemplate = fs.readFileSync(path.join(__dirname, "..", "htmlsMin", "share.min.html").toString());
const icalExportTemplate = fs.readFileSync(path.join(__dirname, "..", "htmlsMin", "icalExport.min.html").toString());

const app = express();
app.use(expressRateLimit({ windowMs: 1000, max: 9 }));
app.use(cors())
app.use(compression());

app.use(express.static("public"));
app.use("/bin", express.static("bin"));
app.use('/.well-known', express.static('.well-known'));

app.get("/ce/*", (req, res) => {
    let weeks = [];
    let currentWeek = dateHelper.getWeek(new Date());
    for (let w = currentWeek; w <= currentWeek + FUTURE_WEEKS; w++) {
        weeks.push(w.toString());
    }

    let key = req.url.slice(4);
    if (key.endsWith(".ics")) {
        key = key.slice(0, -4);
    }
    let pathToICal: string = icalExport.getPathToICalFile(key, weeks);

    if (pathToICal === "") {
        return res.sendStatus(404);
    }

    return res.download(pathToICal, "snabbaschemat-calendar.ics", { headers: { "Content-Type": "text/calendar" } });
});

app.use(cookieParser(security.secret));
app.use(express.json());

app.get("/clear-login", (req, res) => {
    res.clearCookie("name");
    res.clearCookie("password");
    res.redirect("/");
});


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
app.use("/admin", admin.adminRouter(scheduleManager, foodManager, security));

app.get("/", (req, res) => {
    let week: string = dateHelper.getWeek(new Date()).toString();
    if ("week" in req.cookies) {
        week = req.cookies.week;
    }

    let schedule = scheduleTemplate.slice().toString();
    let password = security.decryptRSA(req.cookies.password);
    let cachedSchedule = scheduleManager.getCachedSchedule(req.cookies.name, password, week);

    if (cachedSchedule.status === scheduleManager.CachedScheduleStatus.NoCache) {
        schedule = schedule.replace("<!--! MESSAGE -->", "Det fanns inget sparat schema, laddar in... (Detta kan ta en stund)");
    } else if (cachedSchedule.status === scheduleManager.CachedScheduleStatus.OldLogin) {
        schedule = schedule.replace("<!--! MESSAGE -->", "Fel inloggningsuppgifter till det sparade schemat. Detta kan hända efter ett lösenordsbyte, vänter på att ladda in ett nytt schema...");
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

app.get("/share", (req, res) => {
    return res.type("html").send(shareTemplate.slice().toString());
});

app.get("/export", (req, res) => {
    return res.type("html").send(icalExportTemplate.slice().toString());
})

app.get("/export-key", (req, res) => {
    return res.type("json").send({ key: icalExport.getKey(req.cookies.name) });
})

app.post("/export-start", (req, res) => {
    icalExport.createNewExport(req.cookies.name);
    return res.sendStatus(200);
});

app.post("/export-end", (req, res) => {
    icalExport.disableExport(req.cookies.name);
    return res.sendStatus(200);
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
    let schedules = await scheduleManager.getSchedules(req.cookies.name, password, weeks, req.cookies.week, USE_ONLY_CACHE);

    if (schedules.status === scheduleManager.UpdatedScheduleStatus.WrongLogin) {
        res.clearCookie("name");
        res.clearCookie("password");
        return res.json({ message: "Fel inloggningsuppgifter. Du har blivit utloggad, ladda om sidan för att skriva i nya." });
    } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.ServiceWindow || schedules.status === scheduleManager.UpdatedScheduleStatus.OnlyCached) {
        if (schedules.weeks) {
            let returnWeeks: { [week: string]: scheduleManager.Schedule } = {};
            for (let w of schedules.missingWeeks) {
                if (w in schedules.weeks) {
                    returnWeeks[w] = schedules.weeks[w];
                } else {
                    if (schedules.status === scheduleManager.UpdatedScheduleStatus.ServiceWindow) {
                        returnWeeks[w] = { html: "Schemat har ett service-fönster, kan bara visa tidigare sparade scheman. När service-fönstret är över kommer nya scheman hämtas.", updated: "" };
                    } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.OnlyCached) {
                        returnWeeks[w] = { html: "Snabbaschemat har endast hämtat cachade scheman.", updated: "" };
                    }
                }
            }
            return res.json({ weeks: returnWeeks });
        } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.ServiceWindow) {
            return res.json({ message: "Schemat har ett service-fönster, kan bara visa tidigare sparade scheman. När service-fönstret är över kommer nya scheman hämtas." });
        } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.OnlyCached) {
            return res.json({ message: "Snabbaschemat visar bara sedan tidigare hämtade scheman." });
        }
    } else if (schedules.status === scheduleManager.UpdatedScheduleStatus.Success) {
        if (schedules.weeks) {
            return res.json({ weeks: schedules.weeks });
        }
    }

    return res.json({ message: "Okänt fel vid hämtande av scheman. Ladda om sidan för att försöka igen." });
});

app.post("/food", async (req, res) => {
    let weeks: string[] = [];
    let currentWeek = dateHelper.getWeek(new Date());
    for (let w = currentWeek; w <= currentWeek + FUTURE_WEEKS; w++) {
        weeks.push(w.toString());
    }

    let foodData = await foodManager.getFood(weeks);
    return res.json({ weeks: foodData });
});


if (USE_HTTPS) {
    const httpRedirect = express();
    httpRedirect.all("*", (req, res) => {
        res.redirect(301, 'https://' + req.headers.host + req.url);
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
