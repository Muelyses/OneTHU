import cheerio from "cheerio";
import type {Text} from "domhandler";
// OneTHU 适配：domelementtype 为字符串枚举——字符串字面量 "tag" 与枚举成员类型
// 求交会被 TS 归约为 never（上游代码在新版 domhandler 类型下失配）。改用枚举
// 成员本身，语义不变（Element.type = Tag|Script|Style 的子集）。
import { ElementType } from "domelementtype";
type Cheerio = ReturnType<typeof cheerio>;
type Element = Cheerio[number];
type Tag = Element & {type: ElementType.Tag};

// TODO: Merge two functions
export const getCheerioText = (element: Element, index?: number) =>
    index === undefined
        ? ((element as Tag).firstChild as Text | null | undefined)?.data?.trim() ?? ""
        : (((element as Tag).children[index] as Tag).firstChild as Text | null | undefined)?.data?.trim() ?? "";

export const getTrimmedData = (element: Element, indexChain: number[]) => {
    const tElement = cheerio(element);
    try {
        let res = tElement.children()[indexChain[0]];
        indexChain
            .slice(1)    
            .forEach((val) => {
                res = (res as Tag).children[val] as typeof res;
            });

        return (res as {data?: string}).data?.trim() ?? "";
    } catch {
        return "";
    }
};
