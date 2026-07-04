import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HANGUL_RE = /[가-힣]/;
const KHMER_RE = /[\u1780-\u17FF]/;
const ARTIFACT_RE = /[{}@]|%\s*\d*(?:\s*\$)?\s*[sd]?|&\s*#|https?:|www\.|<[^>]+>|\\[nrt]/i;
const CHO = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];

// 상황별 레슨 코스 (v3.0). 자유 진입, 순서 잠금 없음.
export const LESSONS = [
  { id: "l1", title: "인사와 소개" },
  { id: "l2", title: "숫자와 시간" },
  { id: "l3", title: "기초 표현" },
  { id: "l4", title: "매장에서 — 주문·계산" },
  { id: "l5", title: "시장에서 — 장보기" },
  { id: "l6", title: "이동하기" },
  { id: "l7", title: "긴급·건강" },
  { id: "l8", title: "사람들과 스몰토크" },
  { id: "l9", title: "생활 속 사물" },
];

const CURATED_LESSON_MAP = {
  "인사·기본": "l1",
  "사람·호칭": "l1",
  "숫자": "l2",
  "시간·날짜": "l2",
  "동사·표현": "l3",
  "형용사·상태": "l3",
  "부사·자주 쓰는 말": "l3",
  "생활 표현": "l3",
  "식당·음식": "l4",
  "식당 표현": "l4",
  "요리·양념": "l4",
  "주방·도구": "l4",
  "채소": "l5",
  "과일": "l5",
  "쇼핑·돈": "l5",
  "장소·교통": "l6",
  "여행·지명": "l6",
  "비상·건강": "l7",
  "몸·신체": "l7",
  "나라·언어": "l8",
  "공부·대화": "l8",
  "취미·여가": "l8",
  "자연·날씨": "l8",
  "집·가전": "l9",
  "동물": "l9",
  "옷·소지품": "l9",
  "생활용품": "l9",
  "색깔·기타": "l9",
  "직업·일": "l9",
};

// 각 레슨 끝에 보여줄 간단 대화 예시. ko 텍스트는 반드시 수작업 큐레이션 640개 안에
// 존재하는 문구여야 한다(resolveLessonDialogues가 빌드 시 검증) — 새 크메르어
// 번역을 만들지 않고 검증된 문구만 배치해서 조립한다. 데이터가 명사 위주라 대화가
// 자연스럽게 나오지 않는 레슨(l2/l8/l9)은 의도적으로 비워 둔다.
export const LESSON_DIALOGUE_DEFS = {
  l1: [
    { role: "A", ko: "안녕하세요" },
    { role: "B", ko: "안녕하세요 (정중하게)" },
    { role: "A", ko: "이름이 뭐예요?" },
    { role: "B", ko: "제 이름은 ~예요" },
    { role: "A", ko: "만나서 반가워요" },
    { role: "B", ko: "잘 지내세요?" },
    { role: "A", ko: "잘 지내요" },
    { role: "B", ko: "감사합니다" },
  ],
  l3: [
    { role: "A", ko: "뭐 해요?" },
    { role: "A", ko: "밥 먹었어요?" },
    { role: "B", ko: "먹었어요" },
    { role: "B", ko: "문제 없어요" },
    { role: "A", ko: "화이팅! / 힘내요!" },
  ],
  l4: [
    { role: "손님", ko: "자리 있어요?" },
    { role: "손님", ko: "주문 받아 주세요" },
    { role: "직원", ko: "맛있게 드세요" },
    { role: "손님", ko: "맛있어요" },
    { role: "손님", ko: "계산서 주세요 / 계산할게요" },
    { role: "직원", ko: "또 오세요" },
  ],
  l5: [
    { role: "손님", ko: "얼마예요?" },
    { role: "손님", ko: "비싸요" },
    { role: "손님", ko: "깎아 주세요" },
    { role: "상인", ko: "없어요" },
    { role: "손님", ko: "이거 주세요" },
  ],
  l6: [
    { role: "승객", ko: "왼쪽" },
    { role: "승객", ko: "오른쪽" },
    { role: "승객", ko: "직진 / 똑바로 가세요" },
    { role: "승객", ko: "천천히 가 주세요" },
    { role: "승객", ko: "세워 주세요" },
  ],
  l7: [
    { role: "환자", ko: "배가 아파요" },
    { role: "환자", ko: "열이 나요" },
    { role: "환자", ko: "어지러워요" },
    { role: "주변사람", ko: "조심하세요" },
    { role: "주변사람", ko: "병원에 가야 해요" },
  ],
};

export function resolveLessonDialogues(entries, dialogueDefs = LESSON_DIALOGUE_DEFS) {
  const curatedByKo = new Map();
  for (const entry of entries) {
    if (entry.source === "수작업 기본 단어") curatedByKo.set(entry.ko, entry.id);
  }
  const resolved = {};
  for (const [lessonId, lines] of Object.entries(dialogueDefs)) {
    resolved[lessonId] = lines.map(({ role, ko }) => {
      const id = curatedByKo.get(ko);
      if (id === undefined) {
        throw new Error(`Lesson dialogue "${lessonId}" references unknown curated phrase: "${ko}"`);
      }
      return { role, id };
    });
  }
  return resolved;
}

// OPUS (KDE4/translatewiki) rows are software UI strings, not real-life speech
// (e.g. "메뉴" there means a software menu, not a restaurant menu), so only the
// hand-curated set gets a lesson id; everything else stays out of the 학습 탭
// but remains searchable in 사전.
export function classifyLesson(entry) {
  if (entry.source !== "수작업 기본 단어") return null;
  return CURATED_LESSON_MAP[entry.c] || "l3";
}

const DEFAULT_SOURCES = [
  {
    category: "앱·웹 문장",
    source: "OPUS translatewiki v2025-01-01",
    koFile: "translatewiki.km-ko.ko",
    kmFile: "translatewiki.km-ko.km",
    maxItems: 5000,
    url: "https://opus.nlpl.eu/translatewiki/",
  },
  {
    category: "컴퓨터·도구 문장",
    source: "OPUS KDE4 v2",
    koFile: "KDE4.km-ko.ko",
    kmFile: "KDE4.km-ko.km",
    maxItems: 15000,
    url: "https://opus.nlpl.eu/KDE4/",
  },
];

export function cleanText(value) {
  return String(value ?? "")
    .replace(/\u00a0/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&\s*#\s*160\s*;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s*@\s*[a-z][\w -:]*$/gi, "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isUsefulPair(ko, km) {
  const cleanKo = cleanText(ko);
  const cleanKm = cleanText(km);

  if (cleanKo.length < 2 || cleanKm.length < 2) return false;
  if (cleanKo.length > 80 || cleanKm.length > 120) return false;
  if (!HANGUL_RE.test(cleanKo) || !KHMER_RE.test(cleanKm)) return false;
  if (ARTIFACT_RE.test(cleanKo) || ARTIFACT_RE.test(cleanKm)) return false;
  if (cleanKo.toLowerCase() === cleanKm.toLowerCase()) return false;
  return true;
}

export function extractCuratedData(html) {
  const match = String(html).match(/const\s+DATA\s*=\s*(\[[\s\S]*?\]);/);
  if (!match) return [];

  const data = Function(`"use strict"; return ${match[1]}`)();
  return data.map((entry) => ({
    c: cleanText(entry.c),
    ko: cleanText(entry.ko),
    km: cleanText(entry.km),
    p: cleanText(entry.p),
    ...(entry.r ? { r: cleanText(entry.r) } : {}),
    ...(entry.n ? { n: cleanText(entry.n) } : {}),
  }));
}

export function readParallelRows({ baseDir, koFile, kmFile }) {
  const koRows = fs.readFileSync(path.join(baseDir, koFile), "utf8").split(/\r?\n/);
  const kmRows = fs.readFileSync(path.join(baseDir, kmFile), "utf8").split(/\r?\n/);
  const length = Math.min(koRows.length, kmRows.length);
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    rows.push([koRows[index], kmRows[index]]);
  }
  return rows;
}

function inferType(ko, km) {
  if (ko.length <= 12 && km.length <= 30 && !/[.!?。！？]/.test(ko)) return "word";
  return "sentence";
}

export function koreanInitials(value) {
  return [...String(value ?? "")].map((char) => {
    const code = char.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) return CHO[Math.floor((code - 0xAC00) / 588)];
    return char;
  }).join("");
}

export function searchableText(entry) {
  return [
    entry.ko,
    entry.km,
    entry.p,
    entry.r,
    entry.c,
    entry.n,
    entry.source,
  ].map((value) => cleanText(value).toLowerCase()).join(" ");
}

export function getRelatedEntries(entries, entry, { exampleLimit = 3, relatedLimit = 8 } = {}) {
  const sameCategory = entries.filter((candidate) => candidate.id !== entry.id && candidate.c === entry.c);
  const examples = sameCategory
    .filter((candidate) => candidate.type === "sentence")
    .slice(0, exampleLimit);
  const related = sameCategory
    .slice()
    .sort((a, b) => {
      if (a.type === entry.type && b.type !== entry.type) return -1;
      if (a.type !== entry.type && b.type === entry.type) return 1;
      return a.id - b.id;
    })
    .slice(0, relatedLimit);
  return { examples, related };
}

export function formalityForEntry(entry) {
  const text = `${entry.c || ""} ${entry.ko || ""} ${entry.n || ""}`;
  if (/행정|비자|서류|관공서|정부|은행|허가|등록|공식|제출/.test(text)) return "공식(관공서)";
  if (/직원|동료|일해|일하세요|업무|주방|매장/.test(text)) return "직원에게";
  return "손님·일반";
}

function addEntry(entries, seen, rawEntry) {
  const entry = {
    id: entries.length,
    c: cleanText(rawEntry.c),
    ko: cleanText(rawEntry.ko),
    km: cleanText(rawEntry.km),
    p: cleanText(rawEntry.p),
    r: cleanText(rawEntry.r),
    n: cleanText(rawEntry.n),
    type: rawEntry.type || inferType(cleanText(rawEntry.ko), cleanText(rawEntry.km)),
    source: rawEntry.source || "수작업 기본 단어",
  };
  entry.lesson = rawEntry.lesson || classifyLesson(entry);
  entry.formality = rawEntry.formality || formalityForEntry(entry);

  if (rawEntry.audio) entry.audio = cleanText(rawEntry.audio);

  if (!entry.c || !entry.ko || !entry.km) return false;
  const key = `${entry.ko}\u0000${entry.km}`;
  if (seen.has(key)) return false;

  seen.add(key);
  entries.push(entry);
  return true;
}

export function audioFilenameForId(id) {
  return `${String(id).padStart(6, "0")}.mp3`;
}

export function attachAudioFiles(dictionary, audioFiles = []) {
  const available = new Set(
    audioFiles.filter((file) => /^\d{6}\.mp3$/i.test(file))
  );
  let audioCount = 0;
  const entries = dictionary.entries.map((entry) => {
    const file = audioFilenameForId(entry.id);
    if (!available.has(file)) {
      const { audio, ...withoutAudio } = entry;
      return withoutAudio;
    }
    audioCount += 1;
    return {
      ...entry,
      audio: `audio/${file}`,
    };
  });

  return {
    ...dictionary,
    meta: {
      ...dictionary.meta,
      audioCount,
    },
    entries,
  };
}

export function buildDictionary({ curated, corpora, targetCount = 20000 }) {
  const entries = [];
  const seen = new Set();
  const sourceCounts = {};

  for (const item of curated) {
    if (addEntry(entries, seen, { ...item, source: "수작업 기본 단어" })) {
      sourceCounts["수작업 기본 단어"] = (sourceCounts["수작업 기본 단어"] || 0) + 1;
    }
  }

  for (const corpus of corpora) {
    let addedFromCorpus = 0;
    for (const [ko, km] of corpus.rows) {
      if (entries.length >= targetCount) break;
      if (corpus.maxItems && addedFromCorpus >= corpus.maxItems) break;
      if (!isUsefulPair(ko, km)) continue;

      const added = addEntry(entries, seen, {
        c: corpus.category,
        ko,
        km,
        p: "",
        n: corpus.note || "",
        type: inferType(cleanText(ko), cleanText(km)),
        source: corpus.source,
      });
      if (added) {
        addedFromCorpus += 1;
        sourceCounts[corpus.source] = (sourceCounts[corpus.source] || 0) + 1;
      }
    }
  }

  if (entries.length < targetCount) {
    throw new Error(`Only ${entries.length} useful entries were available; ${targetCount} requested.`);
  }

  const lessonCounts = Object.fromEntries(LESSONS.map(({ id }) => [id, 0]));
  for (const entry of entries) {
    if (entry.lesson) lessonCounts[entry.lesson] += 1;
  }

  return {
    meta: {
      title: "캄보디아어 사전",
      total: entries.length,
      generatedAt: new Date().toISOString(),
      sourceCounts,
      version: "3.1",
      lessons: LESSONS.map(({ id, title }) => ({ id, title, count: lessonCounts[id] })),
      dialogues: {},
      notes: [
        "기본 단어는 사용자가 제공한 HTML의 수작업 데이터에서 가져왔습니다.",
        "대량 문장/용어는 OPUS 공개 병렬 코퍼스에서 필터링했습니다.",
        "OPUS 항목에는 한글식 발음 데이터가 없어 발음 칩을 비워 두었습니다.",
      ],
    },
    entries,
  };
}

function jsonForScript(dictionary) {
  return JSON.stringify(dictionary)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function renderHtml(dictionary) {
  const dataJson = jsonForScript(dictionary);
  return `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#221f1b">
<link rel="manifest" href="./manifest.json">
<link rel="icon" href="./icons/icon-192.png">
<link rel="apple-touch-icon" href="./icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="캄보디아어 사전">
<title>캄보디아어 사전 v3.1</title>
<style>
  :root{
    --bg:#faf7f2; --card:#ffffff; --text:#23231a; --sub:#8a8072;
    --accent:#221f1b; --gold:#b5563a; --pill-bg:transparent; --pill-text:#b5563a;
    --km:#8a4530; --border:#e6ded1; --chip:#ffffff; --chip-on:#ffffff;
    --soft:#f1eae0; --soft-text:#23231a;
  }
  @media (prefers-color-scheme: dark){
    :root{
      --bg:#16130f; --card:#201c17; --text:#ede6d8; --sub:#a89c8a;
      --accent:#0e0c0a; --gold:#c96b4c; --pill-bg:transparent; --pill-text:#c96b4c;
      --km:#e08a6c; --border:#332c22; --chip:#201c17; --chip-on:#ffffff;
      --soft:#241f19; --soft-text:#ede6d8;
    }
  }
  *{box-sizing:border-box; -webkit-tap-highlight-color:transparent;}
  body{
    margin:0; background:var(--bg); color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Noto Sans KR","Noto Sans Khmer","Khmer Sangam MN",sans-serif;
  }
  body.theme-light{
    --bg:#faf7f2; --card:#ffffff; --text:#23231a; --sub:#8a8072;
    --accent:#221f1b; --gold:#b5563a; --pill-bg:transparent; --pill-text:#b5563a;
    --km:#8a4530; --border:#e6ded1; --chip:#ffffff; --chip-on:#ffffff;
    --soft:#f1eae0; --soft-text:#23231a;
  }
  body.theme-dark{
    --bg:#16130f; --card:#201c17; --text:#ede6d8; --sub:#a89c8a;
    --accent:#0e0c0a; --gold:#c96b4c; --pill-bg:transparent; --pill-text:#c96b4c;
    --km:#e08a6c; --border:#332c22; --chip:#201c17; --chip-on:#ffffff;
    --soft:#241f19; --soft-text:#ede6d8;
  }
  body:not(.tab-dict) .search-wrap,
  body:not(.tab-dict) .recent,
  body:not(.tab-dict) .chips{display:none;}
  header{
    position:sticky; top:0; z-index:10; background:var(--accent);
    padding:calc(env(safe-area-inset-top) + 14px) 16px 10px;
    box-shadow:0 2px 10px rgba(0,0,0,.18);
  }
  h1{
    margin:0 0 10px; font-size:20px; color:#f4efe5; letter-spacing:0; display:flex; align-items:center; gap:8px;
    font-family:Georgia,"Noto Serif KR",serif; font-weight:700;
  }
  h1 small{font-size:12px; font-weight:400; font-family:-apple-system,sans-serif; color:#c9bfae; margin-left:auto;}
  .search-wrap{position:relative;}
  #q{
    width:100%; padding:13px 44px 13px 16px; font-size:16px; border:none; border-radius:10px;
    background:#fff; color:#23231a; outline:none;
  }
  @media (prefers-color-scheme: dark){ #q{background:#2a251e; color:#ede6d8;} }
  #clearBtn{
    position:absolute; right:6px; top:50%; transform:translateY(-50%);
    border:none; background:transparent; font-size:18px; color:#a89c8a; padding:8px; display:none;
  }
  .chips{
    display:flex; gap:8px; overflow-x:auto; padding:12px 2px 4px; scrollbar-width:none;
  }
  .chips::-webkit-scrollbar{display:none;}
  .recent{
    display:flex; gap:7px; overflow-x:auto; padding:10px 2px 0; scrollbar-width:none;
  }
  .recent:empty{display:none;}
  .recent::-webkit-scrollbar{display:none;}
  .recent button{
    flex:0 0 auto; border:1px solid rgba(255,255,255,.2); background:rgba(255,255,255,.06);
    color:#d8cfc0; border-radius:14px; padding:7px 11px; font-size:12.5px; max-width:160px;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .chip{
    flex:0 0 auto; padding:7px 13px; border-radius:14px; font-size:12.5px; font-weight:600;
    border:1px solid rgba(255,255,255,.18); background:transparent; color:#8a7f70;
  }
  .chip.on{background:var(--gold); border-color:var(--gold); color:#fff;}
  main{padding:14px 16px calc(env(safe-area-inset-bottom) + 88px); max-width:720px; margin:0 auto;}
  .view{display:none;}
  .view.active{display:block;}
  .summary{color:var(--sub); font-size:12.5px; padding:2px 2px 12px; line-height:1.4;}
  .section-title{font-size:19px; font-weight:700; margin:6px 2px 12px; font-family:Georgia,"Noto Serif KR",serif;}
  .section-sub{font-size:13px; line-height:1.45; color:var(--sub); margin:-4px 2px 12px;}
  .toolbar{display:flex; gap:8px; flex-wrap:wrap; margin:10px 0 14px;}
  .cat-head{
    font-size:12.5px; font-weight:700; color:var(--sub); margin:20px 4px 8px; letter-spacing:1px;
  }
  .card{
    border-bottom:1px solid var(--border); padding:13px 2px; cursor:pointer;
  }
  .row1{display:flex; align-items:flex-start; gap:8px;}
  .ko{font-size:15px; font-weight:700; flex:1; line-height:1.35; overflow-wrap:anywhere;}
  .star{border:none; background:none; font-size:19px; line-height:1; padding:0 2px; color:var(--border); flex:0 0 auto;}
  .star.on{color:var(--gold);}
  .km{
    font-size:22px; line-height:1.5; color:var(--km); margin:6px 0 2px; word-break:break-word;
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .row2{display:flex; align-items:center; gap:10px; margin-top:6px; flex-wrap:wrap;}
  .meta{color:var(--sub); font-size:12.5px; font-weight:400; line-height:1.5;}
  .pron{color:var(--pill-text); font-weight:700;}
  .note{font-size:12.5px; color:var(--sub); width:100%; margin-top:4px;}
  .icon-btn{
    border:1px solid var(--border); background:transparent; color:var(--text);
    border-radius:6px; font-size:13px; font-weight:400; padding:2px 4px; margin-left:auto;
  }
  .row2 .icon-btn, .card .icon-btn{
    border:none; padding:2px 4px; color:var(--sub); font-size:14px; margin-left:0;
  }
  .icon-btn:last-child{margin-left:0;}
  .icon-btn.has-audio{border-color:var(--gold); color:var(--gold); background:transparent;}
  .icon-btn-link{
    border:none; background:none; color:var(--gold); font-weight:600; font-size:13px; padding:1px 6px;
  }
  .detail-backdrop{
    position:fixed; inset:0; display:none; background:rgba(10,8,6,.5); z-index:30;
    align-items:flex-end;
  }
  .detail-backdrop.show{display:flex;}
  .detail-panel{
    width:100%; max-width:720px; max-height:88vh; margin:0 auto; overflow:auto;
    background:var(--bg); color:var(--text); border-radius:18px 18px 0 0;
    padding:18px 16px calc(env(safe-area-inset-bottom) + 18px);
    box-shadow:0 -12px 35px rgba(0,0,0,.28);
  }
  .detail-head{display:flex; align-items:center; gap:10px; margin-bottom:10px;}
  .detail-title{
    font-size:19px; font-weight:700; flex:1; line-height:1.35; overflow-wrap:anywhere;
    font-family:Georgia,"Noto Serif KR",serif;
  }
  .detail-close{border:none; background:var(--soft); color:var(--text); border-radius:50%; width:32px; height:32px; font-size:17px;}
  .detail-km{
    color:var(--km); font-size:30px; line-height:1.45; margin:8px 0;
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .detail-actions{display:flex; gap:16px; flex-wrap:wrap; margin:14px 0;}
  .detail-actions .icon-btn{margin-left:0; border:none; padding:2px 0; color:var(--sub);}
  .detail-actions .icon-btn.has-audio{color:var(--gold); border:1px solid var(--gold); padding:8px 12px; border-radius:6px;}
  .detail-section{border-top:1px solid var(--border); padding-top:13px; margin-top:13px;}
  .detail-section h2{font-size:12.5px; margin:0 0 9px; color:var(--sub); font-weight:700;}
  .mini-list{display:grid; gap:8px;}
  .mini-item{
    border:1px solid var(--border); background:var(--soft); color:var(--text);
    border-radius:8px; padding:9px 10px; text-align:left;
  }
  .mini-ko{font-size:12.5px; font-weight:700; line-height:1.35;}
  .mini-km{
    font-size:17px; color:var(--km); line-height:1.45; margin-top:2px;
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .learning-grid{display:grid; gap:0;}
  .learning-card{
    width:100%; text-align:left; background:none; border:none; border-bottom:1px solid var(--border);
    padding:13px 2px; color:var(--text);
  }
  .learning-card strong{display:block; font-size:14.5px; font-weight:700; margin-bottom:5px;}
  .learning-card span{color:var(--sub); font-size:12px;}
  .study-panel{
    background:var(--card); border:1px solid var(--border); border-radius:8px;
    padding:18px 16px; margin-bottom:12px;
  }
  .study-front{font-size:17px; font-weight:700; line-height:1.5;}
  .study-back{
    font-size:24px; color:var(--km); line-height:1.55; margin-top:8px;
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .lesson-header{display:flex; align-items:center; gap:10px; margin-bottom:14px;}
  .lesson-header strong{flex:1; font-size:15.5px; line-height:1.3; font-family:Georgia,"Noto Serif KR",serif;}
  .lesson-progress{background:var(--soft); border-radius:999px; height:5px; overflow:hidden; margin-top:8px;}
  .lesson-progress-fill{background:var(--gold); height:100%;}
  .lesson-nav{display:flex; gap:8px; margin-top:4px;}
  .lesson-nav button{flex:1; text-align:center; padding:11px;}
  .dialogue-list{display:grid; gap:8px;}
  .dialogue-line{
    border:1px solid var(--border); background:var(--soft); border-radius:8px;
    padding:10px 44px 10px 12px; position:relative;
  }
  .dialogue-role{font-size:11px; font-weight:700; color:var(--sub); text-transform:uppercase; letter-spacing:.5px;}
  .dialogue-ko{font-size:12.5px; font-weight:700; margin-top:2px;}
  .dialogue-km{
    font-size:17px; color:var(--km); margin-top:2px;
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .dialogue-line .icon-btn{position:absolute; top:8px; right:8px; margin:0;}
  .stats-grid{display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px;}
  .stat{background:var(--soft); border-radius:8px; padding:10px; text-align:center;}
  .stat strong{display:block; font-size:15px;}
  .stat span{font-size:11.5px; color:var(--sub);}
  .choice-grid{display:grid; gap:8px; margin-top:10px;}
  .choice-row{display:flex; gap:8px; align-items:center;}
  .choice-row .icon-btn{margin:0; flex:0 0 auto; border:1px solid var(--border); padding:8px 10px;}
  .choice-btn{
    flex:1; text-align:left; border:1px solid var(--border); background:transparent; color:var(--text);
    border-radius:8px; padding:10px 11px; font-size:14px; line-height:1.35;
  }
  .choice-btn .pron{margin-left:8px; font-size:12.5px;}
  .daily-list{display:grid; gap:8px;}
  .daily-item{
    display:flex; align-items:center; gap:8px; border:1px solid var(--border); background:var(--soft);
    border-radius:8px; padding:9px 10px;
  }
  .daily-item-text{
    flex:1; min-width:0; text-align:left; border:none; background:none; color:var(--text);
    display:flex; align-items:center; gap:8px; flex-wrap:wrap;
  }
  .daily-item .mini-ko{font-size:12.5px; font-weight:700;}
  .daily-item .mini-km{
    font-size:15px; color:var(--km);
    font-family:"Noto Serif Khmer","Khmer OS","Noto Sans Khmer","Khmer Sangam MN",serif;
  }
  .daily-item .icon-btn{margin:0; flex:0 0 auto; border:1px solid var(--border); padding:6px 9px;}
  .folder-head{display:flex; gap:8px; align-items:center; margin:10px 0;}
  .folder-head input{
    flex:1; min-width:0; border:1px solid var(--border); background:var(--card); color:var(--text);
    border-radius:8px; padding:10px 12px; font-size:15px;
  }
  .bottom-nav{
    position:fixed; left:0; right:0; bottom:0; z-index:25;
    display:grid; grid-template-columns:repeat(3,1fr); gap:0;
    background:var(--bg); border-top:1px solid var(--border);
    padding:6px 8px calc(env(safe-area-inset-bottom) + 6px);
  }
  .bottom-nav button{
    border:none; background:transparent; color:var(--sub); border-radius:8px;
    padding:2px 0; font-size:12.5px; font-weight:700;
  }
  .bottom-nav button.on{color:var(--text);}
  .empty{text-align:center; color:var(--sub); padding:60px 20px; font-size:15px;}
  #moreBtn{
    display:none; width:100%; margin:14px 0 0; padding:13px 16px; border-radius:8px;
    border:1px solid var(--border); background:transparent; color:var(--text); font-weight:700; font-size:15px;
  }
  #toast{
    position:fixed; bottom:calc(env(safe-area-inset-bottom) + 24px); left:50%; transform:translateX(-50%) translateY(20px);
    background:var(--accent); color:#f4efe5; padding:10px 22px; border-radius:24px; font-size:14px;
    opacity:0; pointer-events:none; transition:all .25s; white-space:nowrap; z-index:20;
  }
  #toast.show{opacity:1; transform:translateX(-50%) translateY(0);}
</style>
</head>
<body class="tab-dict">
<header>
  <h1>🇰🇭 캄보디아어 사전 v3.1 <small id="count"></small></h1>
  <div class="search-wrap">
    <input id="q" type="search" placeholder="한국어·크메르어·발음 검색 (초성 가능)" autocomplete="off">
    <button id="clearBtn" aria-label="지우기">✕</button>
  </div>
  <div class="recent" id="recent"></div>
  <div class="chips" id="chips"></div>
</header>
<main>
  <section class="view active" id="dictView">
    <div class="summary" id="summary"></div>
    <div id="list"></div>
    <button id="moreBtn">더 보기</button>
  </section>
  <section class="view" id="studyView"></section>
  <section class="view" id="bookView"></section>
</main>
<nav class="bottom-nav" id="tabs">
  <button class="on" data-tab="dict">사전</button>
  <button data-tab="study">학습</button>
  <button data-tab="book">단어장</button>
</nav>
<div class="detail-backdrop" id="detail">
  <section class="detail-panel" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
    <div id="detailBody"></div>
  </section>
</div>
<div id="toast"></div>
<script id="dictionary-data" type="application/json">${dataJson}</script>
<script>
const payload = JSON.parse(document.getElementById("dictionary-data").textContent);
const DATA = payload.entries;
const CATS = [...new Set(DATA.map(d=>d.c))];
const AUDIO_COUNT = payload.meta.audioCount || DATA.filter(d=>d.audio).length;
const FAV_KEY = "khdict_fav_20000_v1";
const RECENT_KEY = "khdict_recent_20000_v2";
const LESSON_KEY = "khdict_lessons_v3";
const DAILY_KEY = "khdict_daily_v3";
const BOOK_KEY = "khdict_books_20000_v2";
const THEME_KEY = "khdict_theme_v2";
const PAGE_SIZE = 50;
const BATCH_SIZE = 10;
const LESSONS = payload.meta.lessons || [];
const DIALOGUES = payload.meta.dialogues || {};
let favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY)||"[]"));
let recents = JSON.parse(localStorage.getItem(RECENT_KEY)||"[]");
let lessonProgress = JSON.parse(localStorage.getItem(LESSON_KEY)||"{}");
let dailyState = JSON.parse(localStorage.getItem(DAILY_KEY)||'{"cards":{},"stats":{}}');
let books = JSON.parse(localStorage.getItem(BOOK_KEY)||'{"기본 단어장":[]}');
let curCat = "전체";
let activeTab = "dict";
let visibleLimit = 50;
let currentAudio = null;
let inputTimer;
let studySection = "lessons";
let currentLessonId = null;
let lessonLineIndex = 0;
let lessonRevealed = false;
let lessonReviewMode = false;
let dailyMode = "ko-km";
let currentDailyId = null;
let dailyRevealed = false;

const $q = document.getElementById("q");
const $list = document.getElementById("list");
const $chips = document.getElementById("chips");
const $recent = document.getElementById("recent");
const $clear = document.getElementById("clearBtn");
const $more = document.getElementById("moreBtn");
const $summary = document.getElementById("summary");
const $detail = document.getElementById("detail");
const $detailBody = document.getElementById("detailBody");
const $tabs = document.getElementById("tabs");
const $dictView = document.getElementById("dictView");
const $studyView = document.getElementById("studyView");
const $bookView = document.getElementById("bookView");
document.getElementById("count").textContent = DATA.length.toLocaleString("ko-KR") + "개 수록" + (AUDIO_COUNT ? " · 음성 " + AUDIO_COUNT.toLocaleString("ko-KR") : "");

const CHO = ["ㄱ","ㄲ","ㄴ","ㄷ","ㄸ","ㄹ","ㅁ","ㅂ","ㅃ","ㅅ","ㅆ","ㅇ","ㅈ","ㅉ","ㅊ","ㅋ","ㅌ","ㅍ","ㅎ"];
function toCho(s){
  return [...s].map(ch=>{
    const c = ch.charCodeAt(0);
    if(c>=0xAC00 && c<=0xD7A3) return CHO[Math.floor((c-0xAC00)/588)];
    return ch;
  }).join("");
}
const isChoQuery = s => /^[ㄱ-ㅎ\\s]+$/.test(s);
function norm(s){ return String(s||"").toLowerCase().replace(/\\s+/g,""); }
function match(d, q){
  if(!q) return true;
  if(isChoQuery(q)) return toCho(d.ko).replace(/\\s+/g,"").includes(q.replace(/\\s+/g,""));
  const n = norm(q);
  return [d.ko,d.km,d.p,d.r,d.c,d.n,d.source].some(v=>norm(v).includes(n));
}
function saveFavs(){ localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); }
function saveRecents(){ localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0,30))); }
function saveBooks(){ localStorage.setItem(BOOK_KEY, JSON.stringify(books)); }
function setTheme(theme){
  document.body.classList.remove("theme-light","theme-dark");
  if(theme==="light" || theme==="dark") document.body.classList.add("theme-" + theme);
  localStorage.setItem(THEME_KEY, theme);
}
setTheme(localStorage.getItem(THEME_KEY) || "system");
function commitRecent(value){
  const q = String(value||"").trim();
  if(q.length < 2 && !/[\\u1780-\\u17FF]/.test(q)) return;
  recents = [q, ...recents.filter(item=>item!==q)].slice(0,30);
  saveRecents();
  renderRecent();
}
function renderRecent(){
  $recent.innerHTML = recents.slice(0,8).map(q=>
    '<button data-recent="' + escapeAttr(q) + '">' + escapeHtml(q) + '</button>'
  ).join("");
}
function renderChips(){
  const names = ["전체","★ 즐겨찾기",...CATS];
  $chips.innerHTML = names.map(n=>
    '<button class="chip' + (n===curCat ? ' on' : '') + '" data-cat="' + escapeAttr(n) + '">' + escapeHtml(n) + '</button>'
  ).join("");
}
function escapeHtml(s){
  return String(s ?? "").replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escapeAttr(s){ return escapeHtml(s); }
function getEntry(id){ return DATA[+id]; }
function lessonTitle(lessonId){
  const lesson = LESSONS.find(l=>l.id===lessonId);
  return lesson ? lesson.title : "";
}
function card(d){
  const fav = favs.has(d.id);
  const typeText = d.type === "word" ? "단어" : "문장";
  const audioClass = d.audio ? " has-audio" : "";
  const pron = d.p ? '<span class="pron">' + escapeHtml(d.p) + '</span> ' : "";
  const metaTail = typeText + " · " + escapeHtml(d.c) + (lessonTitle(d.lesson) ? " · " + escapeHtml(lessonTitle(d.lesson)) : "");
  const note = d.n ? '<div class="note">💡 ' + escapeHtml(d.n) + '</div>' : "";
  return '<div class="card" data-id="' + d.id + '">' +
    '<div class="row1">' +
      '<div class="ko">' + escapeHtml(d.ko) + '</div>' +
      '<button class="star' + (fav ? ' on' : '') + '" data-fav="' + d.id + '" aria-label="즐겨찾기">' + (fav ? "★" : "☆") + '</button>' +
    '</div>' +
    '<div class="km">' + escapeHtml(d.km) + '</div>' +
    '<div class="row2">' +
      '<span class="meta">' + pron + metaTail + '</span>' +
      '<button class="icon-btn" data-copy="' + d.id + '">복사</button>' +
      '<button class="icon-btn' + audioClass + '" data-speak="' + d.id + '" aria-label="캄보디아어 음성 재생">🔊</button>' +
    '</div>' +
    note +
  '</div>';
}
function relatedFor(d){
  const same = DATA.filter(item=>item.id!==d.id && item.c===d.c);
  const examples = same.filter(item=>item.type==="sentence").slice(0,3);
  const related = same.slice().sort((a,b)=>{
    if(a.type===d.type && b.type!==d.type) return -1;
    if(a.type!==d.type && b.type===d.type) return 1;
    return a.id - b.id;
  }).slice(0,8);
  return {examples, related};
}
function miniItem(d){
  return '<button class="mini-item" data-detail="' + d.id + '">' +
    '<div class="mini-ko">' + escapeHtml(d.ko) + '</div>' +
    '<div class="mini-km">' + escapeHtml(d.km) + '</div>' +
  '</button>';
}
function openDetail(id){
  const d = DATA[+id];
  if(!d) return;
  const fav = favs.has(d.id);
  const pron = d.p ? '<span class="pron">' + escapeHtml(d.p) + '</span> ' : "";
  const note = d.n ? '<div class="note">💡 ' + escapeHtml(d.n) + '</div>' : "";
  const rel = relatedFor(d);
  const examples = rel.examples.length
    ? rel.examples.map(miniItem).join("")
    : '<div class="empty">연결된 예문 데이터가 아직 없어요</div>';
  const related = rel.related.length
    ? rel.related.map(miniItem).join("")
    : '<div class="empty">같은 카테고리 항목이 없어요</div>';
  const metaParts = [d.type==="word" ? "단어" : "문장", escapeHtml(d.c)];
  if(lessonTitle(d.lesson)) metaParts.push(escapeHtml(lessonTitle(d.lesson)));
  metaParts.push(escapeHtml(d.formality || "손님·일반"));
  if(d.r) metaParts.push(escapeHtml(d.r));
  metaParts.push(escapeHtml(d.source));
  $detailBody.innerHTML =
    '<div class="detail-head">' +
      '<div class="detail-title" id="detailTitle">' + escapeHtml(d.ko) + '</div>' +
      '<button class="detail-close" data-close-detail aria-label="닫기">×</button>' +
    '</div>' +
    '<div class="detail-km">' + escapeHtml(d.km) + '</div>' +
    '<div class="meta">' + pron + metaParts.join(" · ") + '</div>' +
    note +
    '<div class="detail-actions">' +
      '<button class="icon-btn" data-copy="' + d.id + '">복사</button>' +
      '<button class="icon-btn has-audio" data-speak="' + d.id + '">🔊 듣기</button>' +
      '<button class="icon-btn" data-fav="' + d.id + '">' + (fav ? "★ 저장됨" : "☆ 저장") + '</button>' +
      '<button class="icon-btn" data-book-add="' + d.id + '">단어장</button>' +
    '</div>' +
    '<div class="detail-section"><h2>예문</h2><div class="mini-list">' + examples + '</div></div>' +
    '<div class="detail-section"><h2>같은 카테고리 연관 단어</h2><div class="mini-list">' + related + '</div></div>';
  $detail.classList.add("show");
  document.body.style.overflow = "hidden";
}
function closeDetail(){
  $detail.classList.remove("show");
  $detailBody.innerHTML = "";
  document.body.style.overflow = "";
}
function saveLessonProgress(){ localStorage.setItem(LESSON_KEY, JSON.stringify(lessonProgress)); }
function lessonItems(lessonId){ return DATA.filter(d=>d.lesson===lessonId); }
function isLineDone(lessonId, id){ return !!(lessonProgress[lessonId] && lessonProgress[lessonId][id]); }
function toggleLineDone(lessonId, id){
  if(!lessonProgress[lessonId]) lessonProgress[lessonId] = {};
  if(lessonProgress[lessonId][id]) delete lessonProgress[lessonId][id];
  else lessonProgress[lessonId][id] = true;
  saveLessonProgress();
}
function studySectionToggleHtml(){
  return '<div class="toolbar">' +
    '<button class="chip' + (studySection==="lessons" ? " on" : "") + '" data-study-section="lessons">레슨 코스</button>' +
    '<button class="chip' + (studySection==="daily" ? " on" : "") + '" data-study-section="daily">오늘의 단어</button>' +
  '</div>';
}
function renderStudyHome(){
  if(currentLessonId){ renderLessonDetail(); return; }
  if(studySection==="daily") renderDailyView();
  else renderLessonList();
}
function renderLessonList(){
  $studyView.innerHTML = studySectionToggleHtml() +
    '<div class="section-title">학습</div>' +
    '<div class="section-sub">상황별 레슨을 순서에 상관없이 자유롭게 골라 연습하세요. 한 줄씩 탭해서 발음·음성을 확인하고 "외웠어요"로 진행률을 기록하세요.</div>' +
    '<div class="learning-grid">' + LESSONS.map(lesson=>{
      const ids = lessonItems(lesson.id).map(d=>d.id);
      const done = ids.filter(id=>isLineDone(lesson.id, id)).length;
      const pct = ids.length ? Math.round(done / ids.length * 100) : 0;
      return '<button class="learning-card" data-open-lesson="' + lesson.id + '">' +
        '<strong>' + escapeHtml(lesson.title) + '</strong>' +
        '<span>' + done + '/' + ids.length + ' 완료 · ' + pct + '%</span>' +
        '<div class="lesson-progress"><div class="lesson-progress-fill" style="width:' + pct + '%"></div></div>' +
      '</button>';
    }).join("") + '</div>';
}
function openLesson(lessonId){
  currentLessonId = lessonId;
  lessonLineIndex = 0;
  lessonRevealed = false;
  lessonReviewMode = false;
  renderLessonDetail();
}
function closeLesson(){
  currentLessonId = null;
  renderStudyHome();
}
function renderLessonDetail(){
  const lesson = LESSONS.find(l=>l.id===currentLessonId);
  const items = lessonItems(currentLessonId);
  if(!lesson || !items.length){ closeLesson(); return; }
  if(lessonReviewMode){ renderLessonReview(lesson, items); return; }
  if(lessonLineIndex >= items.length) lessonLineIndex = items.length - 1;
  const d = items[lessonLineIndex];
  const done = isLineDone(currentLessonId, d.id);
  const pron = d.p ? '<span class="pron">' + escapeHtml(d.p) + '</span> ' : "";
  $studyView.innerHTML =
    '<div class="lesson-header">' +
      '<button class="icon-btn-link" data-close-lesson>← 목록</button>' +
      '<strong>' + escapeHtml(lesson.title) + '</strong>' +
      '<span class="meta">' + (lessonLineIndex + 1) + ' / ' + items.length + '</span>' +
    '</div>' +
    '<div class="study-panel">' +
      '<div class="study-front">' + escapeHtml(d.ko) + '</div>' +
      (lessonRevealed
        ? '<div class="study-back">' + escapeHtml(d.km) + '</div>' +
          '<div class="meta">' + pron + escapeHtml(d.formality || "손님·일반") + '</div>'
        : '') +
      '<div class="detail-actions">' +
        (lessonRevealed
          ? '<button class="icon-btn has-audio" data-lesson-speak="' + d.id + '">🔊 듣기</button>'
          : '<button class="icon-btn" data-reveal-line>탭해서 보기</button>') +
        '<button class="icon-btn' + (done ? ' has-audio' : '') + '" data-toggle-line="' + d.id + '">' + (done ? '✓ 외웠어요' : '외웠어요') + '</button>' +
      '</div>' +
    '</div>' +
    '<div class="lesson-nav">' +
      '<button class="icon-btn" data-prev-line' + (lessonLineIndex === 0 ? ' disabled' : '') + '>이전</button>' +
      (lessonLineIndex < items.length - 1
        ? '<button class="icon-btn has-audio" data-next-line>다음 줄</button>'
        : '<button class="icon-btn has-audio" data-finish-lesson>전체 복습하기</button>') +
    '</div>';
}
function renderLessonReview(lesson, items){
  const dialogue = DIALOGUES[currentLessonId] || [];
  const dialogueHtml = dialogue.length
    ? '<div class="section-title">간단 대화 예시</div>' +
      '<div class="dialogue-list">' + dialogue.map(line=>{
        const d = getEntry(line.id);
        return '<div class="dialogue-line">' +
          '<div class="dialogue-role">' + escapeHtml(line.role) + '</div>' +
          '<div class="dialogue-ko">' + escapeHtml(d.ko) + '</div>' +
          '<div class="dialogue-km">' + escapeHtml(d.km) + '</div>' +
          '<button class="icon-btn has-audio" data-lesson-speak="' + d.id + '">🔊</button>' +
        '</div>';
      }).join("") + '</div>'
    : "";
  $studyView.innerHTML =
    '<div class="lesson-header">' +
      '<button class="icon-btn-link" data-close-lesson>← 목록</button>' +
      '<strong>' + escapeHtml(lesson.title) + ' 복습</strong>' +
    '</div>' +
    '<div class="section-title">전체 표현 (' + items.length + '개)</div>' +
    '<div class="mini-list">' + items.map(d=>
      '<button class="mini-item" data-lesson-speak="' + d.id + '">' +
        '<div class="mini-ko">' + escapeHtml(d.ko) + '</div>' +
        '<div class="mini-km">' + escapeHtml(d.km) + '</div>' +
      '</button>'
    ).join("") + '</div>' +
    dialogueHtml +
    '<button class="icon-btn" data-restart-lesson style="width:100%;margin-top:12px;">처음부터 다시 연습</button>';
}
function saveDailyState(){ localStorage.setItem(DAILY_KEY, JSON.stringify(dailyState)); }
function curatedWords(){ return DATA.filter(d=>d.source==="수작업 기본 단어"); }
function dailyTodayKey(){ return new Date().toISOString().slice(0,10); }
function dailyYmdPlus(days){
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0,10);
}
function dailyDueDays(box){ return [1,3,7,14,30][Math.max(0, Math.min(4, box - 1))] || 1; }
function dailyCardState(id){
  return dailyState.cards[id] || {box:1, due:dailyTodayKey(), seen:0, correct:0, wrong:0};
}
function currentBatchIndex(){
  const words = curatedWords();
  const totalBatches = Math.max(1, Math.ceil(words.length / BATCH_SIZE));
  for(let b=0;b<totalBatches;b++){
    const batch = words.slice(b*BATCH_SIZE, (b+1)*BATCH_SIZE);
    if(batch.some(d=>!dailyState.cards[d.id])) return b;
  }
  return totalBatches - 1;
}
function dailyTodayItems(){
  const today = dailyTodayKey();
  const words = curatedWords();
  const due = words.filter(d=>{
    const state = dailyState.cards[d.id];
    return state && state.due <= today;
  });
  const batch = words.slice(currentBatchIndex() * BATCH_SIZE, (currentBatchIndex() + 1) * BATCH_SIZE);
  const fresh = batch.filter(d=>!dailyState.cards[d.id]);
  const seen = new Set();
  const result = [];
  for(const d of [...due, ...fresh]){
    if(seen.has(d.id)) continue;
    seen.add(d.id);
    result.push(d);
    if(result.length >= BATCH_SIZE) break;
  }
  return result;
}
function dailyRecordAnswer(id, correct){
  const state = dailyCardState(id);
  const nextBox = correct ? Math.min(5, state.box + 1) : 1;
  dailyState.cards[id] = {
    box: nextBox,
    due: dailyYmdPlus(dailyDueDays(nextBox)),
    seen: state.seen + 1,
    correct: state.correct + (correct ? 1 : 0),
    wrong: state.wrong + (correct ? 0 : 1),
  };
  dailyState.stats[dailyTodayKey()] = (dailyState.stats[dailyTodayKey()] || 0) + 1;
  saveDailyState();
  const next = dailyTodayItems()[0];
  currentDailyId = next ? next.id : null;
  dailyRevealed = false;
  renderDailyView();
}
function dailyStreak(){
  let streak = 0;
  const d = new Date();
  while(true){
    const key = d.toISOString().slice(0,10);
    if(!dailyState.stats[key]) break;
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
function dailyQuizOptions(answer){
  const sameLesson = curatedWords().filter(d=>d.id!==answer.id && d.lesson===answer.lesson);
  const pool = sameLesson.length >= 3 ? sameLesson : curatedWords().filter(d=>d.id!==answer.id);
  const choices = [answer, ...pool.slice(0,3)];
  return choices.sort((a,b)=>((a.id * 17) % 7) - ((b.id * 17) % 7));
}
function dailyListItem(d){
  const pron = d.p ? '<span class="pron">' + escapeHtml(d.p) + '</span>' : "";
  return '<div class="daily-item">' +
    '<button class="daily-item-text" data-detail="' + d.id + '">' +
      '<div class="mini-ko">' + escapeHtml(d.ko) + '</div>' +
      pron +
      '<div class="mini-km">' + escapeHtml(d.km) + '</div>' +
    '</button>' +
    '<button class="icon-btn has-audio" data-lesson-speak="' + d.id + '">🔊</button>' +
  '</div>';
}
function renderDailyView(){
  const today = dailyTodayItems();
  if(!today.length){
    $studyView.innerHTML = studySectionToggleHtml() +
      '<div class="section-title">오늘의 단어</div>' +
      '<div class="empty">모든 단어를 다 학습했어요! 🎉</div>';
    return;
  }
  if(!today.some(d=>d.id===currentDailyId)) currentDailyId = today[0].id;
  const cardEntry = getEntry(currentDailyId) || today[0];
  const state = dailyCardState(cardEntry.id);
  const front = dailyMode==="ko-km" ? cardEntry.ko : cardEntry.km;
  const back = dailyMode==="ko-km" ? cardEntry.km : cardEntry.ko;
  const pron = cardEntry.p ? '<div class="meta"><span class="pron">' + escapeHtml(cardEntry.p) + '</span></div>' : "";
  const totalWords = curatedWords().length;
  const learned = Object.keys(dailyState.cards).length;
  const due = curatedWords().filter(d=>{
    const s = dailyState.cards[d.id];
    return s && s.due <= dailyTodayKey();
  }).length;
  const choices = dailyQuizOptions(cardEntry);
  $studyView.innerHTML = studySectionToggleHtml() +
    '<div class="section-title">오늘의 단어</div>' +
    '<div class="section-sub">전체 ' + totalWords + '개 단어를 순서대로 ' + BATCH_SIZE + '개씩 학습합니다. 지금 배치를 다 학습하면 다음 배치가 열려요.</div>' +
    '<div class="stats-grid">' +
      '<div class="stat"><strong>' + learned + ' / ' + totalWords + '</strong><span>학습 단어</span></div>' +
      '<div class="stat"><strong>' + due + '</strong><span>복습 대상</span></div>' +
      '<div class="stat"><strong>' + dailyStreak() + '</strong><span>연속 학습일</span></div>' +
    '</div>' +
    '<div class="study-panel">' +
      '<div class="meta">Leitner ' + state.box + '/5 · 복습 ' + state.due + ' · ' + (dailyMode==="ko-km" ? "한국어→크메르" : "크메르→한국어") + '</div>' +
      '<div class="study-front">' + escapeHtml(front) + '</div>' +
      (dailyRevealed ? '<div class="study-back">' + escapeHtml(back) + '</div>' + pron : '') +
      '<div class="detail-actions">' +
        '<button class="icon-btn" data-daily-mode>방향 전환</button>' +
        (dailyRevealed
          ? '<button class="icon-btn has-audio" data-lesson-speak="' + cardEntry.id + '">🔊 듣기</button>'
          : '<button class="icon-btn" data-daily-reveal>정답 보기</button>') +
        '<button class="icon-btn" data-daily-wrong="' + cardEntry.id + '">틀림</button>' +
        '<button class="icon-btn has-audio" data-daily-correct="' + cardEntry.id + '">맞음</button>' +
      '</div>' +
    '</div>' +
    '<div class="study-panel">' +
      '<div class="section-title">오늘의 ' + BATCH_SIZE + '단어</div>' +
      '<div class="daily-list">' + today.map(dailyListItem).join("") + '</div>' +
    '</div>' +
    '<div class="study-panel">' +
      '<div class="section-title">4지선다 퀴즈</div>' +
      '<div class="study-front">' + escapeHtml(cardEntry.ko) + '</div>' +
      '<div class="choice-grid">' + choices.map(choice=>{
        const choicePron = choice.p ? '<span class="pron">' + escapeHtml(choice.p) + '</span>' : "";
        return '<div class="choice-row">' +
          '<button class="icon-btn has-audio" data-lesson-speak="' + choice.id + '">🔊</button>' +
          '<button class="choice-btn" data-quiz-choice="' + choice.id + '" data-answer="' + cardEntry.id + '">' + escapeHtml(choice.km) + choicePron + '</button>' +
        '</div>';
      }).join("") + '</div>' +
    '</div>';
}
function addToBook(id){
  const names = Object.keys(books);
  let name = names[0];
  if(names.length > 1) name = prompt("추가할 단어장 이름", names[0]) || names[0];
  if(!books[name]) books[name] = [];
  if(!books[name].includes(+id)) books[name].push(+id);
  saveBooks();
  renderBookView();
  toast("단어장에 추가됨");
}
function exportUserData(){
  const blob = new Blob([JSON.stringify({favs:[...favs], recents, lessonProgress, dailyState, books, exportedAt:new Date().toISOString()}, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "khmer-dictionary-user-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}
function importUserData(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const data = JSON.parse(reader.result);
      favs = new Set(data.favs || []);
      recents = data.recents || [];
      lessonProgress = data.lessonProgress || lessonProgress;
      dailyState = data.dailyState || dailyState;
      books = data.books || books;
      saveFavs(); saveRecents(); saveLessonProgress(); saveDailyState(); saveBooks();
      currentLessonId = null;
      renderRecent(); render(); renderBookView();
      if(activeTab==="study") renderStudyHome();
      toast("사용자 데이터 가져오기 완료");
    }catch(err){ toast("가져오기 JSON을 확인하세요"); }
  };
  reader.readAsText(file);
}
function renderBookView(){
  const folders = Object.keys(books);
  const favoriteItems = [...favs].slice(0,30).map(getEntry).filter(Boolean);
  $bookView.innerHTML =
    '<div class="section-title">단어장</div>' +
    '<div class="section-sub">즐겨찾기와 여러 폴더 단어장을 기기 안에 저장합니다.</div>' +
    '<div class="folder-head"><input id="folderName" placeholder="새 폴더 이름"><button class="icon-btn" data-create-folder>폴더 생성</button></div>' +
    '<div class="toolbar"><button class="icon-btn" data-export>내보내기</button><label class="icon-btn">가져오기<input id="importData" type="file" accept="application/json" style="display:none"></label><button class="icon-btn" data-theme-toggle>다크모드</button></div>' +
    '<div class="study-panel"><div class="section-title">즐겨찾기</div><div class="mini-list">' + (favoriteItems.length ? favoriteItems.map(miniItem).join("") : '<div class="empty">별표로 저장한 단어가 없어요</div>') + '</div></div>' +
    folders.map(name=>{
      const items = (books[name] || []).map(getEntry).filter(Boolean).slice(0,40);
      return '<div class="study-panel"><div class="section-title">' + escapeHtml(name) + ' · ' + (books[name]||[]).length + '</div><div class="mini-list">' + (items.length ? items.map(miniItem).join("") : '<div class="empty">상세 화면에서 단어장 버튼으로 추가하세요</div>') + '</div></div>';
    }).join("");
}
function switchTab(tab){
  activeTab = tab;
  document.body.classList.remove("tab-dict","tab-study","tab-book");
  document.body.classList.add("tab-" + tab);
  [$dictView,$studyView,$bookView].forEach(view=>view.classList.remove("active"));
  ({dict:$dictView, study:$studyView, book:$bookView}[tab]).classList.add("active");
  $tabs.querySelectorAll("button").forEach(btn=>btn.classList.toggle("on", btn.dataset.tab===tab));
  if(tab==="study"){ currentLessonId = null; renderStudyHome(); }
  if(tab==="book") renderBookView();
  window.scrollTo({top:0});
}
function currentItems(){
  const q = $q.value.trim();
  let items = DATA.filter(d=>match(d,q));
  if(curCat==="★ 즐겨찾기") items = items.filter(d=>favs.has(d.id));
  else if(curCat!=="전체") items = items.filter(d=>d.c===curCat);
  return items;
}
function render(){
  const q = $q.value.trim();
  $clear.style.display = q ? "block" : "none";
  const items = currentItems();
  const showing = Math.min(visibleLimit, items.length);
  $summary.textContent = items.length.toLocaleString("ko-KR") + "개 중 " + showing.toLocaleString("ko-KR") + "개 표시";
  if(items.length===0){
    $list.innerHTML = '<div class="empty">' + (curCat==="★ 즐겨찾기"&&!q ? "별표(☆)를 눌러 자주 쓰는 표현을 저장하세요" : "검색 결과가 없어요") + '</div>';
    $more.style.display = "none";
    return;
  }
  const slice = items.slice(0, visibleLimit);
  let html = "";
  if(!q && curCat==="전체"){
    let prev = "";
    for(const d of slice){
      if(d.c!==prev){ html += '<div class="cat-head">' + escapeHtml(d.c) + '</div>'; prev = d.c; }
      html += card(d);
    }
  }else{
    html = slice.map(card).join("");
  }
  $list.innerHTML = html;
  $more.style.display = items.length > visibleLimit ? "block" : "none";
}
function scheduleRender(){
  clearTimeout(inputTimer);
  inputTimer = setTimeout(()=>{
    visibleLimit = 50;
    commitRecent($q.value);
    render();
  }, 200);
}
$q.addEventListener("input", scheduleRender);
$q.addEventListener("keydown", e=>{
  if(e.key==="Enter"){
    clearTimeout(inputTimer);
    visibleLimit = 50;
    commitRecent($q.value);
    render();
  }
});
$clear.addEventListener("click", ()=>{ $q.value=""; visibleLimit = 50; render(); $q.focus(); });
$recent.addEventListener("click", e=>{
  const b = e.target.closest("[data-recent]");
  if(!b) return;
  $q.value = b.dataset.recent;
  visibleLimit = 50;
  commitRecent($q.value);
  render();
});
$chips.addEventListener("click", e=>{
  const b = e.target.closest("[data-cat]");
  if(!b) return;
  curCat = b.dataset.cat;
  visibleLimit = 50;
  renderChips(); render();
  window.scrollTo({top:0});
});
$more.addEventListener("click", ()=>{ visibleLimit += PAGE_SIZE; render(); });
let toastTimer;
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove("show"), 1400);
}
function copyKhmer(d){
  const text = d.km;
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(()=>toast("캄보디아어 복사됨 ✓"));
  }else{
    const ta = document.createElement("textarea");
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand("copy"); ta.remove(); toast("캄보디아어 복사됨 ✓");
  }
}
function toggleFavorite(id){
  favs.has(id) ? favs.delete(id) : favs.add(id);
  saveFavs();
  render();
}
function stopAudio(){
  if(currentAudio){
    currentAudio.pause();
    currentAudio.currentTime = 0;
    currentAudio = null;
  }
  if("speechSynthesis" in window) speechSynthesis.cancel();
}
function getKhmerVoice(){
  if(!("speechSynthesis" in window)) return null;
  return speechSynthesis.getVoices().find(v=>{
    const lang = String(v.lang || "").toLowerCase();
    const name = String(v.name || "").toLowerCase();
    return lang === "km-kh" || lang.startsWith("km") || name.includes("khmer") || name.includes("cambodian");
  }) || null;
}
function speakWithBrowser(text){
  if(!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") return false;
  const voice = getKhmerVoice();
  if(!voice) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = voice.lang || "km-KH";
  u.rate = 0.85;
  u.voice = voice;
  speechSynthesis.speak(u);
  return true;
}
function playKhmerAudio(d){
  stopAudio();
  if(d.audio){
    currentAudio = new Audio(d.audio);
    currentAudio.play()
      .then(()=>toast("캄보디아어 음성 재생"))
      .catch(()=>{
        currentAudio = null;
        if(!speakWithBrowser(d.km)) toast("음성 파일을 재생하지 못했어요");
      });
    return;
  }
  if(speakWithBrowser(d.km)) return;
  toast("캄보디아어 음성 파일이 없어요");
}
if("speechSynthesis" in window){
  speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
  speechSynthesis.getVoices();
}
$tabs.addEventListener("click", e=>{
  const btn = e.target.closest("[data-tab]");
  if(btn) switchTab(btn.dataset.tab);
});
$list.addEventListener("click", e=>{
  const favBtn = e.target.closest("[data-fav]");
  if(favBtn){
    const id = +favBtn.dataset.fav;
    toggleFavorite(id);
    return;
  }
  const copyBtn = e.target.closest("[data-copy]");
  if(copyBtn){
    const d = DATA[+copyBtn.dataset.copy];
    copyKhmer(d);
    return;
  }
  const spBtn = e.target.closest("[data-speak]");
  if(spBtn){
    const d = DATA[+spBtn.dataset.speak];
    playKhmerAudio(d);
    return;
  }
  const detailBtn = e.target.closest("[data-detail]");
  if(detailBtn){
    openDetail(detailBtn.dataset.detail);
    return;
  }
  const cardEl = e.target.closest(".card[data-id]");
  if(cardEl){
    openDetail(cardEl.dataset.id);
  }
});
function handleMiniItemClick(e){
  const mini = e.target.closest(".mini-item[data-detail]");
  if(mini){
    openDetail(mini.dataset.detail);
    return true;
  }
  return false;
}
$studyView.addEventListener("click", e=>{
  const sectionBtn = e.target.closest("[data-study-section]");
  if(sectionBtn){ studySection = sectionBtn.dataset.studySection; renderStudyHome(); return; }
  const openBtn = e.target.closest("[data-open-lesson]");
  if(openBtn){ openLesson(openBtn.dataset.openLesson); return; }
  const closeBtn = e.target.closest("[data-close-lesson]");
  if(closeBtn){ closeLesson(); return; }
  const revealBtn = e.target.closest("[data-reveal-line]");
  if(revealBtn){ lessonRevealed = true; renderLessonDetail(); return; }
  const speakBtn = e.target.closest("[data-lesson-speak]");
  if(speakBtn){ playKhmerAudio(getEntry(speakBtn.dataset.lessonSpeak)); return; }
  const toggleBtn = e.target.closest("[data-toggle-line]");
  if(toggleBtn){ toggleLineDone(currentLessonId, +toggleBtn.dataset.toggleLine); renderLessonDetail(); return; }
  const prevBtn = e.target.closest("[data-prev-line]");
  if(prevBtn){
    if(lessonLineIndex > 0){ lessonLineIndex -= 1; lessonRevealed = false; renderLessonDetail(); }
    return;
  }
  const nextBtn = e.target.closest("[data-next-line]");
  if(nextBtn){ lessonLineIndex += 1; lessonRevealed = false; renderLessonDetail(); return; }
  const finishBtn = e.target.closest("[data-finish-lesson]");
  if(finishBtn){ lessonReviewMode = true; renderLessonDetail(); return; }
  const restartBtn = e.target.closest("[data-restart-lesson]");
  if(restartBtn){
    lessonLineIndex = 0; lessonRevealed = false; lessonReviewMode = false;
    renderLessonDetail();
    return;
  }
  const detailBtn = e.target.closest("[data-detail]");
  if(detailBtn){ openDetail(detailBtn.dataset.detail); return; }
  const dailyModeBtn = e.target.closest("[data-daily-mode]");
  if(dailyModeBtn){ dailyMode = dailyMode==="ko-km" ? "km-ko" : "ko-km"; dailyRevealed = false; renderDailyView(); return; }
  const dailyRevealBtn = e.target.closest("[data-daily-reveal]");
  if(dailyRevealBtn){ dailyRevealed = true; renderDailyView(); return; }
  const dailyWrongBtn = e.target.closest("[data-daily-wrong]");
  if(dailyWrongBtn){ dailyRecordAnswer(+dailyWrongBtn.dataset.dailyWrong, false); return; }
  const dailyCorrectBtn = e.target.closest("[data-daily-correct]");
  if(dailyCorrectBtn){ dailyRecordAnswer(+dailyCorrectBtn.dataset.dailyCorrect, true); return; }
  const quizChoiceBtn = e.target.closest("[data-quiz-choice]");
  if(quizChoiceBtn){
    const ok = +quizChoiceBtn.dataset.quizChoice === +quizChoiceBtn.dataset.answer;
    dailyRecordAnswer(+quizChoiceBtn.dataset.answer, ok);
    toast(ok ? "정답" : "오답");
  }
});
$bookView.addEventListener("click", e=>{
  if(handleMiniItemClick(e)) return;
  if(e.target.closest("[data-create-folder]")){
    const input = document.getElementById("folderName");
    const name = (input.value || "").trim();
    if(!name){ toast("폴더 이름을 입력하세요"); return; }
    if(!books[name]) books[name] = [];
    saveBooks();
    renderBookView();
    return;
  }
  if(e.target.closest("[data-export]")){
    exportUserData();
    return;
  }
  if(e.target.closest("[data-theme-toggle]")){
    const dark = document.body.classList.contains("theme-dark");
    setTheme(dark ? "light" : "dark");
    renderBookView();
  }
});
$bookView.addEventListener("change", e=>{
  const input = e.target.closest("#importData");
  if(input && input.files && input.files[0]) importUserData(input.files[0]);
});
function handleDetailClick(e){
  if(e.target === $detail || e.target.closest("[data-close-detail]")){
    closeDetail();
    return;
  }
  const favBtn = e.target.closest("[data-fav]");
  if(favBtn){
    const id = +favBtn.dataset.fav;
    toggleFavorite(id);
    openDetail(id);
    return;
  }
  const copyBtn = e.target.closest("[data-copy]");
  if(copyBtn){
    copyKhmer(DATA[+copyBtn.dataset.copy]);
    return;
  }
  const spBtn = e.target.closest("[data-speak]");
  if(spBtn){
    playKhmerAudio(DATA[+spBtn.dataset.speak]);
    return;
  }
  const bookBtn = e.target.closest("[data-book-add]");
  if(bookBtn){
    addToBook(+bookBtn.dataset.bookAdd);
    return;
  }
  const detailBtn = e.target.closest("[data-detail]");
  if(detailBtn){
    openDetail(detailBtn.dataset.detail);
  }
}
$detail.addEventListener("click", handleDetailClick);
document.addEventListener("keydown", e=>{
  if(e.key==="Escape" && $detail.classList.contains("show")) closeDetail();
});
renderRecent();
renderChips();
render();
if("serviceWorker" in navigator){
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
</script>
</body>
</html>
`;
}

export function buildFromFiles({ rootDir, targetCount = 20000 }) {
  const sourceHtmlPath = path.join(rootDir, "캄보디아어사전.html");
  const extractedDir = path.join(rootDir, "sources", "extracted");
  const audioDir = path.join(rootDir, "audio");
  const curated = extractCuratedData(fs.readFileSync(sourceHtmlPath, "utf8"));
  const corpora = DEFAULT_SOURCES.map((source) => ({
    ...source,
    rows: readParallelRows({ baseDir: extractedDir, koFile: source.koFile, kmFile: source.kmFile }),
  }));
  const dictionary = buildDictionary({ curated, corpora, targetCount });
  dictionary.meta.dialogues = resolveLessonDialogues(dictionary.entries);
  const audioFiles = fs.existsSync(audioDir) ? fs.readdirSync(audioDir) : [];
  return attachAudioFiles(dictionary, audioFiles);
}

function main() {
  const currentFile = fileURLToPath(import.meta.url);
  const rootDir = path.resolve(path.dirname(currentFile), "..");
  const dictionary = buildFromFiles({ rootDir, targetCount: 20000 });
  const jsonPath = path.join(rootDir, "khmer_dictionary_20000.json");
  const htmlPath = path.join(rootDir, "캄보디아어사전_20000.html");

  fs.writeFileSync(jsonPath, `${JSON.stringify(dictionary, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlPath, renderHtml(dictionary), "utf8");
  console.log(`Wrote ${dictionary.entries.length} entries`);
  console.log(jsonPath);
  console.log(htmlPath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
