import fs from "fs";
import path from "path";
import crypto from "crypto";
const jsencrypt = require("node-jsencrypt");

import { NextFunction, Request, Response } from "express";

interface ActivationInformation {
    activationTime: string;
    activationKey: string;
    lastAuthentication: string;
    authenticationCount: number;
    clearedLogin: boolean;
}

interface ActivationCode {
    used: boolean;
    usedOn: string;
}

export enum ActivateCodeStatus {
    InvalidCode,
    Success
}

export interface ActivateCodeReturn {
    uuid?: string;
    status: ActivateCodeStatus;
}

export const secret: string = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "private", "secret.json")).toString()).secret;

const PRIVATE_KEY = fs.readFileSync(path.join(__dirname, '..', 'private', 'rsa_2048_priv.pem')).toString().replace(/\r?\n|\r/g, "");
export const PUBLIC_KEY = fs.readFileSync(path.join(__dirname, '..', 'private', 'rsa_2048_pub.pem')).toString().replace(/\r?\n|\r/g, "");

const activeUUIDsPath = path.join(__dirname, "..", "private", "activeUUIDs.json");
const activationCodesPath = path.join(__dirname, "..", "private", "activationCodes.json");

const activateHTMLPath = path.join(__dirname, "..", "htmlsMin", "activate.min.html");
const loginHTMLPath = path.join(__dirname, "..", "htmlsMin", "login.min.html");

const activeUUIDs: { [uuid: string]: ActivationInformation } = JSON.parse(fs.readFileSync(activeUUIDsPath).toString());
const activationCodes: { [activationCode: string]: ActivationCode } = JSON.parse(fs.readFileSync(activationCodesPath).toString());

const loginTemplate = fs.readFileSync(loginHTMLPath).toString().replace("-----PUBLIC KEY-----", PUBLIC_KEY);

export function authenticate(req: Request, res: Response, next: NextFunction) {
    if ("uuid" in req.signedCookies) {
        if (req.signedCookies.uuid in activeUUIDs) {
            activeUUIDs[req.signedCookies.uuid].lastAuthentication = new Date().toUTCString();
            activeUUIDs[req.signedCookies.uuid].authenticationCount++;
            fs.writeFileSync(activeUUIDsPath, JSON.stringify(activeUUIDs, null, 2));
            return next();
        } else {
            res.clearCookie("uuid");
            res.clearCookie("name");
            res.clearCookie("password");
            return res.sendFile(activateHTMLPath);
        }
    }

    res.clearCookie("name");
    res.clearCookie("password");

    return res.sendFile(activateHTMLPath);
}

export function login(req: Request, res: Response, next: NextFunction) {
    if (activeUUIDs[req.signedCookies.uuid].clearedLogin) {
        if ("name" in req.cookies && "password" in req.cookies) {
            return next();
        }
    } else {
        activeUUIDs[req.signedCookies.uuid].clearedLogin = true;
        res.clearCookie("name");
        res.clearCookie("password");
    }

    res.type("html").send(loginTemplate);
}

export function activateCode(code: string): ActivateCodeReturn {
    if (code in activationCodes && !activationCodes[code].used) {
        let now = new Date().toUTCString();

        activationCodes[code].used = true;
        activationCodes[code].usedOn = now;

        let uuid = "";
        if (uuid === "" || uuid in activeUUIDs) {
            uuid = generateRandomString(256);
        }
        activeUUIDs[uuid] = {
            activationTime: now,
            activationKey: code,
            lastAuthentication: now,
            authenticationCount: 0,
            clearedLogin: true
        }

        fs.writeFileSync(activationCodesPath, JSON.stringify(activationCodes, null, 2));
        fs.writeFileSync(activeUUIDsPath, JSON.stringify(activeUUIDs, null, 2));

        return { uuid: uuid, status: ActivateCodeStatus.Success };
    }

    return { status: ActivateCodeStatus.InvalidCode }
}

export function encryptRSA(message: string) {
    let encryptorRSA = new jsencrypt();
    encryptorRSA.setPublicKey(PUBLIC_KEY);
    return encryptorRSA.encrypt(message);
}

export function decryptRSA(message: string) {
    let decryptorRSA = new jsencrypt();
    decryptorRSA.setPrivateKey(PRIVATE_KEY);
    return decryptorRSA.decrypt(message);
}

function generateRandomString(length: number) {
    return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
};
