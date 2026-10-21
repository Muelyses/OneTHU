import {AES, enc, mode, pad} from "crypto-js";
import {roam, roamingWrapperWithMocks} from "./core";
import {InfoHelper} from "../index";
import {uFetch} from "../utils/network";
import {
    CARD_CANCEL_LOSS_URL,
    CARD_CHANGE_PWD_URL,
    CARD_I_VERSION_URL,
    CARD_INFO_BY_USER_URL,
    CARD_MOD_MAX_CONSUME_URL,
    CARD_PHOTO_URL, CARD_RECHARGE_FROM_ALIPAY_URL,
    CARD_RECHARGE_FROM_BANK_URL,
    CARD_REPORT_LOSS_URL,
    CARD_TRANSACTION_URL,
    CARD_USER_BY_TOKEN_URL,
    CONTENT_TYPE_JSON,
} from "../constants/strings";
import {CardInfo} from "../models/card/info";
import {CardTransaction, CardTransactionType} from "../models/card/transaction";
import {MOCK_CARD_INFO} from "../mocks/card";
import {LibError, LoginError} from "../utils/error";

const CARD_API_VERSION = 2;

const accountBaseInfo = {
    user: "",
    cardId: "",
};

/** 单字段级容错（2026-10-12 校园卡「易崩」专项）：接口字段缺失/类型漂移时给安全默认，
 *  绝不让 undefined/null 漏进 UI（UI 侧 `.toFixed`/`getMonth` 一类调用会整树崩）。 */
const numOr = (v: unknown, divisor = 1, fallback = 0): number => {
    const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) ? n / divisor : fallback;
};
/** 日期字段容错：非法/缺失给「纪元」而不是 Invalid Date（后者在 UI 上会显示 Invalid Date）。 */
const asDate = (v: unknown): Date => {
    if (v instanceof Date) return Number.isFinite(v.getTime()) ? v : new Date(0);
    const d = new Date(typeof v === "string" || typeof v === "number" ? v : NaN);
    return Number.isFinite(d.getTime()) ? d : new Date(0);
};

const fetchWithParse = async (url: string, jsonStruct: any = {}) => {
    const response = await uFetch(url, JSON.stringify(jsonStruct) as any, undefined, undefined, true, CONTENT_TYPE_JSON);
    // ① 解析容错：卡服务在会话失效/被 webvpn 引导壳拦截时回的是 HTML，此前 JSON.parse 直接
    //    抛「Unexpected token '<'」——用户只看到整栏崩掉，无从判断是登录态问题。
    let parsed: any;
    try {
        parsed = JSON.parse(response);
    } catch {
        const head = String(response ?? "").trim().slice(0, 60).replace(/\s+/g, " ");
        const looksHtml = /^</.test(head);
        throw new LibError(
            looksHtml
                ? "校园卡服务返回的是网页而不是数据（登录态可能已失效，或网络被引导页拦截）——请到「设置 → 账号」重新登录后重试。"
                : `校园卡服务返回无法解析的内容（前 60 字：${head || "空"}）`,
        );
    }
    const {data, success, resultData} = parsed ?? {};
    if (success) {
        return resultData;
    }
    if (typeof data !== "string" || data.length <= 16) {
        throw new LibError(`校园卡服务返回异常（缺少可解密数据；success=${String(success)}）`);
    }
    // ② 解密分支同样容错：坏数据/密钥不符时给可读错误，而不是抛 crypto-js 的内部异常
    let result: any;
    try {
        const decrypt = AES.decrypt(data.substring(16), enc.Utf8.parse(data.substring(0, 16)), {mode: mode.ECB, padding: pad.Pkcs7});
        const decString = enc.Utf8.stringify(decrypt).toString();
        result = JSON.parse(decString);
    } catch {
        throw new LibError("校园卡服务返回的数据解密失败（可能接口版本已变，请反馈日志）");
    }
    if (result?.success !== true) {
        throw new LibError(String(result?.message ?? "校园卡服务返回失败"));
    }
    return result.resultData;
};

const assureLoginValid = async (helper: InfoHelper) => {
    if (helper.userId === "") {
        const e = new LoginError("Please login.");
        helper.loginErrorHook && helper.loginErrorHook(e);
        throw e;
    }
    try {
        if ((await fetchWithParse(CARD_USER_BY_TOKEN_URL)).loginuser !== accountBaseInfo.user) {
            await cardLogin(helper);
        }
    }
    catch {
        await cardLogin(helper);
    }
};

export const cardLogin = async (helper: InfoHelper): Promise<void> => {
    if (helper.mocked()) {
        return;
    }
    await roam(helper, "card", "eea30cbedcaf97c69d28b2d92f22a259/0?/userindex");
    accountBaseInfo.user = (await fetchWithParse(CARD_USER_BY_TOKEN_URL)).loginuser;
};

export const cardGetInfo = async (helper: InfoHelper): Promise<CardInfo> => {
    if (helper.mocked()) {
        return MOCK_CARD_INFO;
    }
    await assureLoginValid(helper);

    const rawInfoStruct = await fetchWithParse(CARD_INFO_BY_USER_URL, {idserial: accountBaseInfo.user});

    // ③ 结构容错（2026-10-12）：`baseAccount` / `cardInfos[0]` 缺失时此前是
    //    「Cannot read properties of undefined (reading '0')」——整栏崩掉且用户看不懂。
    //    现在缺字段给安全默认，并保留原始数据供上层判断「这是不是一张有效卡」。
    const raw = (rawInfoStruct ?? {}) as Record<string, any>;
    const base = (raw.baseAccount ?? {}) as Record<string, any>;
    const cards = Array.isArray(raw.cardInfos) ? raw.cardInfos : [];
    const card = (cards[0] ?? {}) as Record<string, any>;
    const info: CardInfo = {
        userId: String(raw.idserial ?? ""),
        userName: String(raw.username ?? ""),
        userNameEn: String(raw.engname ?? ""),
        departmentName: String(raw.departname ?? ""),
        departmentNameEn: String(raw.engdepartname ?? ""),
        departmentId: numOr(raw.departid),
        photoFileName: String(raw.photofile ?? ""),
        phoneNumber: String(raw.tel ?? ""),
        userGender: String(raw.sex ?? ""),
        effectiveTimestamp: asDate(raw.identifyeffectdate),
        validTimestamp: asDate(raw.validatevalue),
        balance: numOr(base.balance, 100),
        cardId: String(card.cardid ?? ""),
        cardStatus: String(card.accstatus ?? ""),
        lastTransactionTimestamp: asDate(card.lasttxdate),
        maxDailyTransactionAmount: numOr(card.maxconstolamt, 100),
        maxOneTimeTransactionAmount: numOr(card.maxconsamt, 100),
    };

    accountBaseInfo.cardId = info.cardId;
    return info;
};

export const cardGetPhotoUrl = () => CARD_PHOTO_URL + accountBaseInfo.cardId;

export const cardGetTransactions = async (
    helper: InfoHelper,
    start: string,  // YYYY-MM-DD
    end: string,    // YYYY-MM-DD
    type: CardTransactionType = CardTransactionType.Any)
    : Promise<CardTransaction[]> => {
    if (helper.mocked()) {
        return [];
    }
    await assureLoginValid(helper);

    const rawTransactionsData = await fetchWithParse(CARD_TRANSACTION_URL,
        {
            idserial: accountBaseInfo.user,
            starttime: start,
            endtime: end,
            tradetype: type,
            pageSize: 10000,
            pageNumber: 0,
        });

    // ④ 行级容错：`rows` 缺失/非数组、单行金额为 null 都不再抛错（此前 rows.map 直接崩）
    const rows = Array.isArray((rawTransactionsData as any)?.rows) ? (rawTransactionsData as any).rows : [];
    return rows.map((rawTransaction: any) => ({
        id: String(rawTransaction?.id ?? ""),
        summary: String(rawTransaction?.summary ?? ""),
        timestamp: asDate(rawTransaction?.txdate),
        balance: numOr(rawTransaction?.balance, 100),
        amount: numOr(rawTransaction?.txamt, 100),
        address: String(rawTransaction?.meraddr ?? ""),
        name: String(rawTransaction?.mername ?? ""),
        txName: String(rawTransaction?.txname ?? ""),
    } as CardTransaction));
};

export const cardChangeTransactionPassword = async (helper: InfoHelper, oldPassword: string, newPassword: string) => {
    if (helper.mocked()) {
        return;
    }
    await assureLoginValid(helper);

    await fetchWithParse(CARD_CHANGE_PWD_URL,
        {
            idserial: accountBaseInfo.user,
            oldpassword: oldPassword,
            txpassword: newPassword,
            authOldPwd: true,
        });
};

export const cardModifyMaxTransactionAmount = async (
    helper: InfoHelper,
    transactionPassword: string,
    maxDailyTranscationAmount: number,
    maxOneTimeTranscationAmount: number) => {
    if (helper.mocked()) {
        return;
    }
    await assureLoginValid(helper);

    if (accountBaseInfo.cardId === "") {
        await cardGetInfo(helper);
    }

    await fetchWithParse(CARD_MOD_MAX_CONSUME_URL, {
        maxconsamt: Math.floor(maxDailyTranscationAmount * 100),
        maxconstolamt: Math.floor(maxOneTimeTranscationAmount * 100),
        txpassword: transactionPassword,
        cardid: accountBaseInfo.cardId,
    });
};

export const cardReportLoss = async (helper: InfoHelper, transactionPassword: string) => {
    if (helper.mocked()) {
        return;
    }
    await assureLoginValid(helper);

    await fetchWithParse(CARD_REPORT_LOSS_URL,
        {
            idserial: accountBaseInfo.user,
            txpasswd: transactionPassword,
        });
};

export const cardCancelLoss = async (helper: InfoHelper, transactionPassword: string) => {
    if (helper.mocked()) {
        return;
    }
    await assureLoginValid(helper);

    await fetchWithParse(CARD_CANCEL_LOSS_URL,
        {
            idserial: accountBaseInfo.user,
            txpasswd: transactionPassword,
        });
};

export const canRechargeCampusCard = async (helper: InfoHelper) =>
    roamingWrapperWithMocks(
        helper,
        undefined,
        "",
        async () => {
            try {
                const {version} = await uFetch(CARD_I_VERSION_URL).then(JSON.parse);
                return version <= CARD_API_VERSION;
            } catch {
                throw new Error("Failed to query card API version.");
            }
        },
        false,
    );

export const cardRechargeFromBank = async (helper: InfoHelper, transactionPassword: string, amount: number) => {
    if (helper.mocked()) {
        return;
    }
    await assureLoginValid(helper);

    const {returncode} = await fetchWithParse(CARD_RECHARGE_FROM_BANK_URL,
        {
            idserial: accountBaseInfo.user,
            txamt: Math.floor(amount * 100),
        });
    if (returncode === "ERROR") {
        throw new LibError("圈存失败。请使用其他支付方式，或在 6:00~20:40 进行银行卡圈存。");
    }
};

const enum CardRechargeType {
    Wechat = "综合服务微信扫码充值",
    Alipay = "综合服务支付宝扫码充值",
}

export const cardRechargeFromWechatAlipay = async (helper: InfoHelper, amount: number, alipay: boolean)
    : Promise<string> => {
    if (helper.mocked()) {
        return "";
    }
    await assureLoginValid(helper);

    if (alipay) {
        const rawResponse = await fetchWithParse(CARD_RECHARGE_FROM_ALIPAY_URL,
            {
                idserial: accountBaseInfo.user,
                transamt: amount,
                paytype: 3,
                txcode: "2493",
                productdesc: CardRechargeType.Alipay,
                method: "trade.pay.qrcode",
                tradetype: "alipay.qrcode",
            });

        if (rawResponse.success !== true) {
            throw new Error(rawResponse.message);
        }

        const paymentUrl = JSON.parse(rawResponse.response).bizContent.webUrl;

        const payCode = paymentUrl.substring(paymentUrl.lastIndexOf("/") + 1);

        return "alipayqr://platformapi/startapp?saId=10000007&qrcode=https%3A%2F%2Fqr.alipay.com%2F" + payCode;
    }

    else {
        const rawResponse = await fetchWithParse(CARD_RECHARGE_FROM_ALIPAY_URL,
            {
                idserial: accountBaseInfo.user,
                transamt: amount,
                txamt: amount,
                openid: "",
                orgid: 2,
                paytype: 2,
                txcode: "1824",
                productdesc: CardRechargeType.Wechat,
                method: "trade.pay.qrcode",
                tradetype: "weixin.qrcode",
            });

        if (rawResponse.success !== true) {
            throw new Error(rawResponse.message);
        }

        return JSON.parse(rawResponse.response).bizContent.webUrl;
    }
};
