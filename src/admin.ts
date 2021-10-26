
import * as fs from 'fs';
import * as path from 'path';
import * as express from 'express';

export enum AdminRequestResponseStatus {
    Unsuccessful = "Unsuccessful operation",
    Success = "Success"
}

export interface AdminRequestResponseReturn {
    status: AdminRequestResponseStatus;
    message?: string;
}

const adminHeaderFilePath = path.join(__dirname, "..", "htmls", "admin", "header.html");
const adminHeaderHTML = fs.readFileSync(adminHeaderFilePath).toString();

const adminFooterFilePath = path.join(__dirname, "..", "htmls", "admin", "footer.html");
const adminFooterHTML = fs.readFileSync(adminFooterFilePath).toString();

const adminMissingImplementationFilePath = path.join(__dirname, "..", "htmls", "admin", "missingImplementation.html");
const adminMissingImplementationHTML = fs.readFileSync(adminMissingImplementationFilePath).toString();

const modules: string[] = ["food", "activationCodes", "userCache"];

var modulesHTML: { [moduleName: string]: string } = {};
for (let moduleName of modules) {
    modulesHTML[moduleName] = fs.readFileSync(path.join(__dirname, "..", "htmls", "admin", "modules", moduleName + ".html")).toString();
}

export function adminRouter(scheduleManager: typeof import("./scheduleManager"), foodManager: typeof import("./foodManager"), security: typeof import("./security")): express.Router {
    let router = express.Router();

    router.get("/", (req, res) => {
        if (req.userPermission === undefined) {
            return res.sendStatus(500);
        }

        if (req.userPermission === undefined || Object.values(req.userPermission.permissions).every(item => item === false)) {
            return res.redirect("/");
        }

        let adminPage = "";
        adminPage += adminHeaderHTML;

        for (let permission in req.userPermission.permissions) {
            if (!req.userPermission.permissions[permission]) {
                continue;
            }

            if (modules.includes(permission)) {
                adminPage += modulesHTML[permission];
            } else {
                adminPage += adminMissingImplementationHTML.replace("<!--! PERMISSION -->", permission);
            }
        }

        adminPage += adminFooterHTML;

        return res.type("html").send(adminPage);
    });

    router.post("/clearCachedFoods", (req, res) => {
        if (!hasPermission(req, "food")) {
            return res.sendStatus(403);
        }

        let operationReturn: AdminRequestResponseReturn = foodManager.clearCachedFoods();
        return res.type("json").send(JSON.stringify(operationReturn));
    });

    router.post("/updateFoodLink", (req, res) => {
        if (!hasPermission(req, "food")) {
            return res.sendStatus(403);
        }

        if (!("newFoodLink" in req.body)) {
            return res.sendStatus(400);
        }

        let operationReturn: AdminRequestResponseReturn = foodManager.updateFoodLink(req.body.newFoodLink);
        return res.type("json").send(JSON.stringify(operationReturn));
    });

    router.get("/currentFoodLink", (req, res) => {
        if (!hasPermission(req, "food")) {
            return res.sendStatus(403);
        }

        res.type("json").send(JSON.stringify({ foodLink: foodManager.getFoodLink() }));
    });

    router.post("/enableNewActivationCode", (req, res) => {
        if (!hasPermission(req, "activationCodes") || !req.userPermission) {
            return res.sendStatus(403);
        }

        if (!("newActivationCode" in req.body)) {
            return res.sendStatus(400);
        }

        let operationReturn: AdminRequestResponseReturn = security.enableNewActivationCode(req.body.newActivationCode, req.userPermission.userCode);
        res.type("json").send(JSON.stringify(operationReturn));
    });

    router.get("/userList", (req, res) => {
        if (!hasPermission(req, "individualUsers")) {
            return res.sendStatus(403);
        }

        res.type("json").send(JSON.stringify(scheduleManager.getUserList()));
    });

    router.post("/clearAllUserCache", (req, res) => {
        if (!hasPermission(req, "userCache")) {
            return res.sendStatus(403);
        }

        res.type("json").send(JSON.stringify(scheduleManager.clearAllUserCache()));
    });

    router.post("/clearOneUserCache", (req, res) => {
        if (!hasPermission(req, "userCache") || !hasPermission(req, "individualUsers")) {
            return res.sendStatus(403);
        }

        if (!("user" in req.body)) {
            return res.sendStatus(400);
        }

        let operationReturn: AdminRequestResponseReturn = scheduleManager.clearOneUserCache(req.body.user);
        res.type("json").send(JSON.stringify(operationReturn));
    });

    return router;
}

function hasPermission(req: express.Request, permissionName: string): boolean {
    return req.userPermission !== undefined && permissionName in req.userPermission.permissions && req.userPermission.permissions[permissionName];
}