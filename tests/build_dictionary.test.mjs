import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  attachAudioFiles,
  audioFilenameForId,
  buildDictionary,
  classifyLesson,
  cleanText,
  extractCuratedData,
  formalityForEntry,
  getRelatedEntries,
  isUsefulPair,
  koreanInitials,
  LESSON_DIALOGUE_DEFS,
  LESSONS,
  renderHtml,
  resolveLessonDialogues,
  searchableText,
} from "../scripts/build_dictionary.mjs";

test("cleanText normalizes whitespace and strips common corpus artifacts", () => {
  assert.equal(cleanText("  파일\u00a0올리기  "), "파일 올리기");
  assert.equal(cleanText("찾기 & # 160; :"), "찾기 :");
  assert.equal(cleanText("최근 파일 @ info - notification message"), "최근 파일");
  assert.equal(cleanText("선택 해제@ info: tooltip"), "선택 해제");
  assert.equal(cleanText("Kanagram 종료@ title: group main settings page name"), "Kanagram 종료");
});

test("isUsefulPair accepts Korean-Khmer text and rejects noisy corpus rows", () => {
  assert.equal(isUsefulPair("파일 올리기", "ចាប់ផ្ដើមផ្ទុកឡើង"), true);
  assert.equal(isUsefulPair("{{PLURAL|one=%1$d개 파일}}", "{{PLURAL|one=%1$d ឯកសារ}}"), false);
  assert.equal(isUsefulPair("출력:% 1", "លទ្ធផល ៖% 1"), false);
  assert.equal(isUsefulPair("파일을 larossa@ kde. org로 보내 주십시오.", "សូមផ្ញើ​ឯកសារ​នេះ​ទៅ larrosa"), false);
  assert.equal(isUsefulPair("Microsoft", "Microsoft"), false);
  assert.equal(isUsefulPair("한국어만 있음", "English only"), false);
  assert.equal(isUsefulPair("a".repeat(90), "ចាប់ផ្ដើមផ្ទុកឡើង"), false);
});

test("extractCuratedData reads the inline DATA array from the reference HTML", () => {
  const html = `
    <script>
    const DATA = [
      {c:"인사", ko:"안녕하세요", km:"សួស្តី", p:"쑤어쓰다이"},
      {c:"숫자", ko:"1 하나", km:"មួយ", p:"무이", n:"기본 숫자"},
    ];
    </script>
  `;
  assert.deepEqual(extractCuratedData(html), [
    { c: "인사", ko: "안녕하세요", km: "សួស្តី", p: "쑤어쓰다이" },
    { c: "숫자", ko: "1 하나", km: "មួយ", p: "무이", n: "기본 숫자" },
  ]);
});

test("buildDictionary keeps curated entries first and fills to the target count", () => {
  const curated = [
    { c: "인사", ko: "안녕하세요", km: "សួស្តី", p: "쑤어쓰다이" },
  ];
  const corpora = [
    {
      category: "앱·컴퓨터",
      source: "KDE4",
      rows: [
        ["파일 올리기", "ចាប់ផ្ដើមផ្ទុកឡើង"],
        ["파일 올리기", "ចាប់ផ្ដើមផ្ទុកឡើង"],
        ["로그인", "កត់ឈ្មោះចូល"],
        ["{{PLURAL|one=%1$d개 파일}}", "{{PLURAL|one=%1$d ឯកសារ}}"],
      ],
    },
  ];

  const result = buildDictionary({ curated, corpora, targetCount: 3 });

  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.id), [0, 1, 2]);
  assert.deepEqual(result.entries.map((entry) => entry.ko), ["안녕하세요", "파일 올리기", "로그인"]);
  assert.equal(result.entries[0].p, "쑤어쓰다이");
  assert.equal(result.entries[1].p, "");
  assert.equal(result.entries[1].source, "KDE4");
  assert.equal(result.meta.total, 3);
});

test("attachAudioFiles links local mp3 files by zero-padded entry id", () => {
  const dictionary = {
    meta: { title: "캄보디아어 사전", total: 3 },
    entries: [
      { id: 0, c: "인사", ko: "안녕하세요", km: "សួស្តី", p: "", n: "", type: "word", source: "test" },
      { id: 1, c: "인사", ko: "감사합니다", km: "អរគុណ", p: "", n: "", type: "word", source: "test" },
      { id: 12, c: "식당", ko: "물 주세요", km: "សុំទឹកមួយ", p: "", n: "", type: "sentence", source: "test" },
    ],
  };

  assert.equal(audioFilenameForId(12), "000012.mp3");

  const result = attachAudioFiles(dictionary, ["000000.mp3", "000012.mp3", "notes.txt"]);

  assert.equal(result.meta.audioCount, 2);
  assert.equal(result.entries[0].audio, "audio/000000.mp3");
  assert.equal(result.entries[1].audio, undefined);
  assert.equal(result.entries[2].audio, "audio/000012.mp3");
});

test("search helpers include romanization fields and Korean initials", () => {
  const entry = {
    ko: "감사합니다",
    km: "អរគុណ",
    p: "어꾼",
    r: "awkun",
    c: "인사",
    n: "정중한 표현",
    source: "test",
  };

  assert.equal(koreanInitials("감사합니다"), "ㄱㅅㅎㄴㄷ");
  assert.match(searchableText(entry), /awkun/);
  assert.match(searchableText(entry), /អរគុណ/);
  assert.match(searchableText(entry), /정중한 표현/);
});

test("getRelatedEntries returns same-category examples and related items", () => {
  const entries = [
    { id: 0, c: "식당", ko: "물", km: "ទឹក", type: "word" },
    { id: 1, c: "식당", ko: "물 주세요", km: "សុំទឹកមួយ", type: "sentence" },
    { id: 2, c: "식당", ko: "밥", km: "បាយ", type: "word" },
    { id: 3, c: "인사", ko: "안녕하세요", km: "សួស្តី", type: "word" },
  ];

  const related = getRelatedEntries(entries, entries[0], { exampleLimit: 2, relatedLimit: 2 });

  assert.deepEqual(related.examples.map((entry) => entry.id), [1]);
  assert.deepEqual(related.related.map((entry) => entry.id), [2, 1]);
});

test("classifyLesson maps curated categories to the 9 lesson ids and formalityForEntry infers register", () => {
  const curated = (c, ko) => ({ c, ko, source: "수작업 기본 단어" });
  assert.equal(classifyLesson(curated("식당·음식", "계산해 주세요")), "l4");
  assert.equal(classifyLesson(curated("채소", "양파")), "l5");
  assert.equal(classifyLesson(curated("장소·교통", "공항에 가요")), "l6");
  assert.equal(classifyLesson(curated("비상·건강", "병원")), "l7");
  assert.equal(classifyLesson(curated("인사·기본", "안녕하세요")), "l1");
  assert.equal(classifyLesson(curated("동사·표현", "가다")), "l3");
  assert.equal(formalityForEntry({ ko: "비자 서류를 제출합니다", c: "행정" }), "공식(관공서)");
  assert.equal(formalityForEntry({ ko: "손님 감사합니다", c: "식당 표현" }), "손님·일반");
  assert.equal(formalityForEntry({ ko: "직원에게 말해요", c: "직업·일" }), "직원에게");
});

test("classifyLesson excludes OPUS/software-corpus entries even on keyword coincidence", () => {
  assert.equal(classifyLesson({ c: "메뉴", ko: "둘러보기 메뉴", source: "OPUS KDE4 v2" }), null);
  assert.equal(
    classifyLesson({ c: "이동", ko: "문서 이동", source: "OPUS translatewiki v2025-01-01" }),
    null
  );
});

test("resolveLessonDialogues resolves every dialogue line to a curated entry id", () => {
  const entries = [
    { id: 0, ko: "안녕하세요", source: "수작업 기본 단어" },
    { id: 1, ko: "테스트 문구", source: "수작업 기본 단어" },
  ];
  const resolved = resolveLessonDialogues(entries, {
    demo: [{ role: "A", ko: "안녕하세요" }, { role: "B", ko: "테스트 문구" }],
  });
  assert.deepEqual(resolved.demo, [{ role: "A", id: 0 }, { role: "B", id: 1 }]);
});

test("resolveLessonDialogues throws when a dialogue line has no matching curated entry", () => {
  const entries = [{ id: 0, ko: "안녕하세요", source: "수작업 기본 단어" }];
  assert.throws(
    () => resolveLessonDialogues(entries, { demo: [{ role: "A", ko: "존재하지 않는 문구" }] }),
    /존재하지 않는 문구/
  );
});

test("every real LESSON_DIALOGUE_DEFS line exists in the actual curated source HTML", () => {
  const rootDir = fileURLToPath(new URL("..", import.meta.url));
  const sourceHtml = fs.readFileSync(path.join(rootDir, "캄보디아어사전.html"), "utf8");
  const curated = extractCuratedData(sourceHtml);
  const { entries } = buildDictionary({ curated, corpora: [], targetCount: curated.length });
  assert.doesNotThrow(() => resolveLessonDialogues(entries, LESSON_DIALOGUE_DEFS));
});

test("LESSONS covers 9 lesson ids with titles", () => {
  assert.equal(LESSONS.length, 9);
  for (const lesson of LESSONS) {
    assert.match(lesson.id, /^l[1-9]$/);
    assert.ok(lesson.title.length > 0);
  }
});

test("renderHtml embeds JSON that can be parsed back from the data script", () => {
  const dictionary = {
    meta: {
      title: "캄보디아어 사전",
      total: 1,
      audioCount: 1,
      lessons: [{ id: "l1", title: "인사와 소개", count: 1 }],
      dialogues: { l1: [{ role: "A", id: 0 }] },
    },
    entries: [
      {
        id: 0,
        c: "테스트",
        ko: "태그 확인",
        km: "សាកល្បង <script>",
        p: "",
        n: "",
        type: "sentence",
        source: "test",
        audio: "audio/000000.mp3",
        lesson: "l1",
        formality: "손님·일반",
      },
    ],
  };
  const html = renderHtml(dictionary);
  const match = html.match(/<script id="dictionary-data" type="application\/json">([\s\S]*?)<\/script>/);
  assert.ok(match);
  assert.deepEqual(JSON.parse(match[1]), dictionary);
  assert.match(html, /function playKhmerAudio/);
  assert.match(html, /new Audio/);
  assert.match(html, /RECENT_KEY/);
  assert.match(html, /function openDetail/);
  assert.match(html, /visibleLimit = 50/);
  assert.match(html, /setTimeout\(\(\)=>/);
  assert.doesNotMatch(html, /data-tab="phrase"/);
  assert.match(html, /data-tab="study"/);
  assert.match(html, /function renderLessonList/);
  assert.match(html, /function renderLessonDetail/);
  assert.match(html, /function renderLessonReview/);
  assert.match(html, /function renderDailyView/);
  assert.match(html, /function renderBookView/);
  assert.match(html, /function exportUserData/);
  assert.match(html, /Leitner/);
  assert.match(html, /data-study-section="daily"/);
  assert.match(html, /data-quiz-choice/);
});
