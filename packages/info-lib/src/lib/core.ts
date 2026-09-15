import {
    DOUBLE_AUTH_URL,
    GET_COOKIE_URL,
    GITLAB_AUTH_URL,
    GITLAB_LOGIN_URL,
    ID_BASE_URL,
    ID_HOST_URL,
    ID_LOGIN_URL,
    INVOICE_LOGIN_URL,
    LOGIN_URL,
    LOGOUT_URL,
    ROAMING_URL,
    SAVE_FINGER_URL,
    USER_DATA_URL,
    WEB_VPN_ID_BASE_URL,
    WEB_VPN_ID_LOGIN_URL,
    WEB_VPN_OAUTH_LOGIN_URL,
} from "../constants/strings";
import cheerio from "cheerio";
import {InfoHelper} from "../index";
import {clearCookies, getRedirectUrl, uFetch} from "../utils/network";
import {sm2Pass} from "../utils/sm2";
import {IdAuthError, LibError, LoginError, UrlError} from "../utils/error";
import {loginCr} from "./cr";

type RoamingPolicy = "default" | "id" | "card" | "cab" | "gitlab" | "cr";

const HOST_MAP: { [key: string]: string } = {
    "zhjw.cic": "77726476706e69737468656265737421eaff4b8b69336153301c9aa596522b20bc86e6e559a9b290",
    "jxgl.cic": "77726476706e69737468656265737421faef469069336153301c9aa596522b20e33c1eb39606919f",
    "ecard": "77726476706e69737468656265737421f5f4408e237e7c4377068ea48d546d303341e9882a",
    "learn": "77726476706e69737468656265737421fcf2408e297e7c4377068ea48d546d30ca8cc97bcc",
    "mails": "77726476706e69737468656265737421fdf64890347e7c4377068ea48d546d3011ff591d40",
    "50": "77726476706e69737468656265737421a5a70f8834396657761d88e29d51367b6a00",
    "166.111.14.8": "77726476706e69737468656265737421a1a117d27661391e2f5cc7f4",
    "fa-online": "77726476706e69737468656265737421f6f60c93293c615e7b469dbf915b243daf0f96e17deaf447b4",
    "dzpj": "77726476706e69737468656265737421f4ed519669247b59700f81b9991b2631aee63c51",
    "jjhyhdf": "77726476706e69737468656265737421fafd49852f346e1e6a1b80a29f5d36342bb9c40cf69277",
    "yhdf": "77726476706e69737468656265737421e9ff459a69247b59700f81b9991b26317dbd36ae",
    "usereg": "77726476706e69737468656265737421e5e4448e223726446d0187ab9040227b54b6c80fcd73",
    "thos": "77726476706e69737468656265737421e4ff4e8f69247b59700f81b9991b2631ca359dd4",
};

const parseUrl = (urlIn: string) => {
    const rawRes = /http:\/\/(\d+.\d+.\d+.\d+):(\d+)\/(.+)/g.exec(urlIn);
    if (rawRes !== null && rawRes[1] !== undefined && rawRes[2] !== undefined && rawRes[3] !== undefined) {
        return `https://webvpn.tsinghua.edu.cn/http-${rawRes[2]}/${HOST_MAP[rawRes[1]]}/${rawRes[3]}`;
    }
    const protocol = urlIn.substring(0, urlIn.indexOf(":"));
    const regRes = /:\/\/(.+?).tsinghua.edu.cn(:(\d+))?\/(.+)/.exec(urlIn);
    if (regRes === null || regRes[1] === undefined || regRes[4] === undefined) {
        throw new UrlError();
    }
    const host = regRes[1];
    const protocolFull = regRes[3] === undefined ? protocol : `${protocol}-${regRes[3]}`;
    const path = regRes[4];
    return `https://webvpn.tsinghua.edu.cn/${protocolFull}/${HOST_MAP[host]}/${path}`;
};

export const getCsrfToken = async () => {
    const cookie = await uFetch(GET_COOKIE_URL);
    const q = /XSRF-TOKEN=(.+?);/.exec(cookie + ";");
    if (q === null || q[1] === undefined) {
        throw new Error("Failed to get csrf token.");
    }
    return q[1];
};

let outstandingLoginPromise: Promise<void> | undefined = undefined;

const twoFactorAuth = async (helper: InfoHelper): Promise<string> => {
    // OneTHU 适配：FIND_APPROACHES 返回含 hasTotp（OneTHU demoLogin 同源发现）；
    // totp 验证动作为 VERITY_TOTP_CODE，其余为 VERITY_CODE。
    const { result: r1, msg: m1, object: { hasWeChatBool, phone, hasTotp } } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
        action: "FIND_APPROACHES",
    }));
    if (r1 != "success") {
        throw new LoginError(m1);
    }
    if (!helper.twoFactorMethodHook) {
        throw new LoginError("Required to select 2FA method");
    }
    const method = await helper.twoFactorMethodHook(hasWeChatBool, phone, hasTotp === true);
    if (method === undefined) {
        throw new LoginError("2FA required");
    }
    if (method !== "totp") {
        const { result: r2, msg: m2 } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
            action: "SEND_CODE",
            type: method,
        }));
        if (r2 != "success") {
            throw new LoginError(m2);
        }
    }
    if (!helper.twoFactorAuthHook) {
        throw new LoginError("2FA required");
    }
    const code = await helper.twoFactorAuthHook();
    if (code === undefined) {
        throw new LoginError("2FA required");
    }
    const { result: r3, msg: m3, object: { redirectUrl } } = JSON.parse(await uFetch(DOUBLE_AUTH_URL, {
        action: method === "totp" ? "VERITY_TOTP_CODE" : "VERITY_CODE",
        vericode: code,
    }));
    if (r3 != "success") {
        throw new LoginError(m3);
    }
    if (helper.trustFingerprintHook) {
        const trustFingerprint = await helper.trustFingerprintHook();
        if (trustFingerprint) {
            // OneTHU 适配：①deviceName 用注入名（默认上游名）；②响应 object 即受信
            // 凭据（OneTHU finger3），存 helper.fingerGenPrint 供下次登录免 2FA；
            // ③失败不炸登录（受信设备数达上限时应继续完成登录而非报错）。
            const { result: r4, msg: m4, object: o4 } = JSON.parse(await uFetch(SAVE_FINGER_URL, {
                fingerprint: helper.fingerprint,
                deviceName: helper.trustFingerprintNameHook ? await helper.trustFingerprintNameHook() : "THU Info APP",
                radioVal: "是",
                singleLogin: "",
            }));
            if (r4 == "success") {
                helper.fingerGenPrint = o4 && typeof o4 === "string" ? o4 : helper.fingerGenPrint;
            } else if (helper.twoFactorAuthLimitHook && (String(m4).includes("上限") || String(m4).includes("limit"))) {
                await helper.twoFactorAuthLimitHook();
            }
        }
    }
    return await uFetch(ID_HOST_URL + redirectUrl);
};

export const login = async (
    helper: InfoHelper,
    userId: string,
    password: string,
): Promise<void> => {
    helper.userId = userId;
    helper.password = password;
    if (helper.userId === "" || helper.password === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (!helper.userId.match(/^\d+$/)) {
        const e = new LoginError("请输入学号。");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    if (!helper.mocked()) {
        clearCookies();
        await helper.clearCookieHandler();
        if (outstandingLoginPromise === undefined) {
            outstandingLoginPromise = new Promise<void>((resolve, reject) => {
                setTimeout(() => {
                    reject(new LoginError("Login timeout."));
                }, 3 * 60 * 1000);
                (async () => {
                    await uFetch(LOGIN_URL);
                    // OneTHU 适配：oauth_login 落地页即 id 登录表单，含 #sm2publicKey；
                    // 密码按页面公钥 SM2 加密（注入器缺失时回退明文=上游原行为）
                    const oauthPage = await uFetch(WEB_VPN_OAUTH_LOGIN_URL);
                    let response = await uFetch(ID_LOGIN_URL, {
                        i_user: helper.userId,
                        i_pass: sm2Pass(oauthPage, helper.password),
                        fingerPrint: helper.fingerprint,
                        fingerGenPrint: helper.fingerGenPrint ?? "",
                        i_captcha: "",
                    });
                    if (response.includes("二次认证")) {
                        response = await twoFactorAuth(helper);
                    }
                    if (!response.includes("登录成功。正在重定向到")) {
                        const $ = cheerio.load(response);
                        const message = $("#msg_note").text().trim();
                        throw new LoginError(message);
                    }
                    const redirectUrl = await getRedirectUrl(cheerio("a", response).attr().href);
                    if (redirectUrl === LOGIN_URL) {
                        throw new LoginError("登录失败，请稍后重试。");
                    }
                    await roam(helper, "id", "10000ea055dd8d81d09d5a1ba55d39ad");
                    outstandingLoginPromise = undefined;
                })().then(resolve, (e: any) => {
                    const loginError = new LoginError(e?.message);
                    helper.loginErrorHook && helper.loginErrorHook(loginError);
                    outstandingLoginPromise = undefined;
                    reject(loginError);
                });
            });
        }
        await outstandingLoginPromise;
    }
};

export const logout = async (helper: InfoHelper): Promise<void> => {
    if (!helper.mocked()) {
        helper.userId = "";
        helper.password = "";
        await uFetch(LOGOUT_URL);
    } else {
        helper.userId = "";
        helper.password = "";
    }
};

export const roam = async (helper: InfoHelper, policy: RoamingPolicy, payload: string): Promise<string> => {
    switch (policy) {
    case "default": {
        const csrf = await getCsrfToken();
        const {object} = await uFetch(`${ROAMING_URL}?yyfwid=${payload}&_csrf=${csrf}&machine=p`, {}).then(JSON.parse);
        const url = parseUrl(object.roamingurl.replace(/&amp;/g, "&"));
        if (url.includes(HOST_MAP["dzpj"])) {
            const roamHtml = await uFetch(url);
            const username = /\("username"\).value = '(.+?)';/.exec(roamHtml);
            if (username === null || username[1] === undefined) {
                throw new LibError("Failed to get username when roaming to fa-online");
            }
            const password = /\("password"\).value = '(.+?)';/.exec(roamHtml);
            if (password === null || password[1] === undefined) {
                throw new LibError("Failed to get password when roaming to fa-online");
            }
            return await uFetch(INVOICE_LOGIN_URL, {username: username[1], password: password[1]});
        }
        return await uFetch(url);
    }
    case "card":
    case "cab":
    case "id": {
        const idBaseUrl = policy === "card" ? ID_BASE_URL : WEB_VPN_ID_BASE_URL;
        const idLoginUrl = policy === "card" ? ID_LOGIN_URL : WEB_VPN_ID_LOGIN_URL;
        let response = "";
        for (let i = 0; i < 2; i++) {
            // OneTHU 适配：表单页即含 #sm2publicKey，逐次提取加密
            const formPage = await uFetch(idBaseUrl + payload);
            response = await uFetch(idLoginUrl, {
                i_user: helper.userId,
                i_pass: sm2Pass(formPage, helper.password),
                fingerPrint: helper.fingerprint,
                fingerGenPrint: helper.fingerGenPrint ?? "",
                i_captcha: "",
            });
            if (response.includes("二次认证")) {
                response = await twoFactorAuth(helper);
            }
            if (response.includes("登录成功。正在重定向到")) {
                break;
            }
        }
        if (!response.includes("登录成功。正在重定向到")) {
            throw new IdAuthError();
        }
        const redirectUrl = cheerio("a", response).attr().href;

        return await uFetch(redirectUrl);
    }
    case "gitlab": {
        const data = await uFetch(GITLAB_LOGIN_URL);
        if (data.includes("sign_out")) return data;
        const authenticity_token = cheerio.load(data)("[name=authenticity_token]").attr().value;
        const gitlabAuthPage = await uFetch(GITLAB_AUTH_URL, {authenticity_token});
        let response = await uFetch(ID_LOGIN_URL, {
            i_user: helper.userId,
            i_pass: sm2Pass(gitlabAuthPage, helper.password),
            fingerPrint: helper.fingerprint,
            fingerGenPrint: helper.fingerGenPrint ?? "",
            i_captcha: "",
        });
        if (response.includes("二次认证")) {
            response = await twoFactorAuth(helper);
        }
        if (!response.includes("登录成功。正在重定向到")) {
            throw new IdAuthError();
        }
        const redirectUrl = cheerio("a", response).attr().href;
        return await uFetch(redirectUrl);
    }
    case "cr": {
        await loginCr(helper);
        return "";
    }
    }
};

export const verifyAndReLogin = async (helper: InfoHelper): Promise<boolean> => {
    if (outstandingLoginPromise) {
        await outstandingLoginPromise;
        return true;
    }
    try {
        const {object} = await uFetch(`${USER_DATA_URL}?_csrf=${await getCsrfToken()}`).then(JSON.parse);
        if (object.ryh === helper.userId) {
            return false;
        }
    } catch {
        //
    }
    const {userId, password} = helper;
    await login(helper, userId, password);
    return true;
};

export const roamingWrapper = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
): Promise<R> => {
    if (helper.userId === "" || helper.password === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    try {
        if (policy) {
            try {
                return await operation();
            } catch {
                let result: string;
                try {
                    result = await roam(helper, policy, payload);
                } catch {
                    result = await roam(helper, policy, payload);
                }
                return await operation(result);
            }
        } else {
            return await operation();
        }
    } catch (e) {
        if (await verifyAndReLogin(helper)) {
            if (policy) {
                const result = await roam(helper, policy, payload);
                return await operation(result);
            } else {
                return await operation();
            }
        } else {
            throw e;
        }
    }
};

export const roamingWrapperWithMocks = async <R>(
    helper: InfoHelper,
    policy: RoamingPolicy | undefined,
    payload: string,
    operation: (param?: string) => Promise<R>,
    fallback: R,
): Promise<R> =>
    helper.mocked()
        ? Promise.resolve(fallback)
        : roamingWrapper(helper, policy, payload, operation);
