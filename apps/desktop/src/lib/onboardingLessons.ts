import { localizedList as i18nList } from "../i18n/index.js";
import { t as i18n } from "../i18n/index.js";
/** Mode-specific lessons. Pure content: importing this file never reads or writes saved preferences. */
import type { ExperienceMode } from "../state/experienceMode.js";

export type TourTarget = "home" | "workspaces" | "vault" | "organization" | "onego" | "plugins" | "appearance" | "learn" | "data" | "practical";
export interface Lesson {
  id: string;
  title: string;
  lead: string;
  steps: string[];
  target?: TourTarget;
  action?: string;
}

/** Full mode teaches its five distinctive workflows; secondary tools remain discoverable at the end. */
export const FULL_LESSONS: Lesson[] = [
  {
    id: "board", get title() { return i18n("lib.onboardinglessons.481859b46c3d"); }, get lead() { return i18n("lib.onboardinglessons.938cf6754eca"); },
    get steps() { return i18nList(["lib.onboardinglessons.ed00d331fead","lib.onboardinglessons.f544c165cc0d","lib.onboardinglessons.f0286e41a800"]); },
    target: "home", get action() { return i18n("lib.onboardinglessons.54b50ff31359"); },
  },
  {
    id: "vault", get title() { return i18n("lib.onboardinglessons.4c3730561869"); }, get lead() { return i18n("lib.onboardinglessons.fd97d45a4baf"); },
    get steps() { return i18nList(["lib.onboardinglessons.ba184b90db25","lib.onboardinglessons.00bc1d36170d","lib.onboardinglessons.a71a30210ed8"]); },
    target: "vault", get action() { return i18n("lib.onboardinglessons.6670a347d233"); },
  },
  {
    id: "code", get title() { return i18n("lib.onboardinglessons.00548ebf0094"); }, get lead() { return i18n("lib.onboardinglessons.d202897590a6"); },
    get steps() { return i18nList(["lib.onboardinglessons.860909859b77","lib.onboardinglessons.edf2196ae042","lib.onboardinglessons.8201b1567e8a"]); },
    target: "vault", get action() { return i18n("lib.onboardinglessons.4f8b0079e9a7"); },
  },
  {
    id: "nfc", get title() { return i18n("lib.onboardinglessons.477ee6905e99"); }, get lead() { return i18n("lib.onboardinglessons.4766925e81fa"); },
    get steps() { return i18nList(["lib.onboardinglessons.821c17e0cd8b","lib.onboardinglessons.6a2d23072180","lib.onboardinglessons.5d5e509cc246"]); },
    target: "vault", get action() { return i18n("lib.onboardinglessons.9697b3ac8ab8"); },
  },
  {
    id: "organization", get title() { return i18n("lib.onboardinglessons.74b07795cf47"); }, get lead() { return i18n("lib.onboardinglessons.da33da7edc5c"); },
    get steps() { return i18nList(["lib.onboardinglessons.a7d4fd864624","lib.onboardinglessons.836d1b485b82","lib.onboardinglessons.b54256466693"]); },
    target: "organization", get action() { return i18n("lib.onboardinglessons.b0e75e43d9da"); },
  },
];

/** Optional full-mode discoveries retain every existing real destination. */
export const EXTRA_LESSONS: Lesson[] = [
  {
    id: "explorer", get title() { return i18n("lib.onboardinglessons.22953a2b1d3d"); }, get lead() { return i18n("lib.onboardinglessons.eb8d4b7fd8d5"); },
    get steps() { return i18nList(["lib.onboardinglessons.bb1ddb4acdff","lib.onboardinglessons.2d15ea7e97cf","lib.onboardinglessons.65019eafede2"]); },
    target: "workspaces", get action() { return i18n("lib.onboardinglessons.59899f30d40e"); },
  },
  {
    id: "onego", get title() { return i18n("lib.onboardinglessons.6946e33b26a8"); }, get lead() { return i18n("lib.onboardinglessons.e225304e8091"); },
    get steps() { return i18nList(["lib.onboardinglessons.017861453458","lib.onboardinglessons.046948f474c9","lib.onboardinglessons.cb18708acfd3"]); },
    target: "onego", get action() { return i18n("lib.onboardinglessons.e84b694246af"); },
  },
  {
    id: "plugin", get title() { return i18n("lib.onboardinglessons.2ae24bb56fc5"); }, get lead() { return i18n("lib.onboardinglessons.9521224b68f9"); },
    get steps() { return i18nList(["lib.onboardinglessons.9d06bd60c326","lib.onboardinglessons.22c2c5850280","lib.onboardinglessons.fd6248cc4365","lib.onboardinglessons.71a055fe9ac4","lib.onboardinglessons.28ba892a80d1"]); },
    target: "plugins", get action() { return i18n("lib.onboardinglessons.b262a001f2d3"); },
  },
  {
    id: "customize", get title() { return i18n("lib.onboardinglessons.abeb15db61bc"); }, get lead() { return i18n("lib.onboardinglessons.7afcd8d783a6"); },
    get steps() { return i18nList(["lib.onboardinglessons.f9d887f9253a","lib.onboardinglessons.2f58de82e70b","lib.onboardinglessons.6334522bd244"]); },
    target: "appearance", get action() { return i18n("lib.onboardinglessons.96110462ab73"); },
  },
  {
    id: "campus", get title() { return i18n("lib.onboardinglessons.e27c03ed11b7"); }, get lead() { return i18n("lib.onboardinglessons.579d6942635d"); },
    get steps() { return i18nList(["lib.onboardinglessons.32ec402487b2","lib.onboardinglessons.5cf01f986896","lib.onboardinglessons.91753f91e6a4"]); },
    target: "learn", get action() { return i18n("lib.onboardinglessons.d79d92647cba"); },
  },
  {
    id: "data", get title() { return i18n("lib.onboardinglessons.65909de13b31"); }, get lead() { return i18n("lib.onboardinglessons.48ad9a755b42"); },
    get steps() { return i18nList(["lib.onboardinglessons.dcdb4647f456","lib.onboardinglessons.7177d5881f00","lib.onboardinglessons.38a50a046992"]); },
    target: "data", get action() { return i18n("lib.onboardinglessons.a497b5391775"); },
  },
];

export const SIMPLE_LESSONS: Lesson[] = [
  {
    id: "today", get title() { return i18n("lib.onboardinglessons.2ef7a07ed1a6"); }, get lead() { return i18n("lib.onboardinglessons.a2fc98611a51"); },
    get steps() { return i18nList(["lib.onboardinglessons.2d32fc5fb4ab","lib.onboardinglessons.a5ba218d1130","lib.onboardinglessons.fe79c11b666f"]); },
    target: "home", get action() { return i18n("lib.onboardinglessons.b53e0caf08d4"); },
  },
  {
    id: "quick", get title() { return i18n("lib.onboardinglessons.7a1d19ef38cd"); }, get lead() { return i18n("lib.onboardinglessons.fdb99497532e"); },
    get steps() { return i18nList(["lib.onboardinglessons.04e1cf0948a0","lib.onboardinglessons.eb8b58642cd4","lib.onboardinglessons.c0def71d3a4b"]); },
    target: "home", get action() { return i18n("lib.onboardinglessons.d66e6fe01e59"); },
  },
];

export const PRACTICAL_LESSONS: Lesson[] = [
  {
    id: "today", get title() { return i18n("lib.onboardinglessons.2ef7a07ed1a6"); }, get lead() { return i18n("lib.onboardinglessons.5179f2bbf334"); },
    get steps() { return i18nList(["lib.onboardinglessons.2d32fc5fb4ab","lib.onboardinglessons.a5ba218d1130","lib.onboardinglessons.befddfd12f6f"]); },
    target: "home", get action() { return i18n("lib.onboardinglessons.b53e0caf08d4"); },
  },
  {
    id: "more", get title() { return i18n("lib.onboardinglessons.3d0109a1f308"); }, get lead() { return i18n("lib.onboardinglessons.4afe5510ffd6"); },
    get steps() { return i18nList(["lib.onboardinglessons.b63a952e8a2d","lib.onboardinglessons.1d136c57be9a"]); },
    target: "practical", get action() { return i18n("lib.onboardinglessons.bab05287556d"); },
  },
  {
    id: "swap", get title() { return i18n("lib.onboardinglessons.a77d0e6c7c2d"); }, get lead() { return i18n("lib.onboardinglessons.5c0e2772ea36"); },
    get steps() { return i18nList(["lib.onboardinglessons.ec9325752ccc","lib.onboardinglessons.227ccdc30302","lib.onboardinglessons.80a9c0e2e534"]); },
    target: "practical", get action() { return i18n("lib.onboardinglessons.d6dc9c00faa7"); },
  },
];

export function lessonsForMode(mode: ExperienceMode): Lesson[] {
  return mode === "simple" ? SIMPLE_LESSONS : mode === "practical" ? PRACTICAL_LESSONS : FULL_LESSONS;
}
