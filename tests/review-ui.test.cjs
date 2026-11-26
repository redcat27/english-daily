require('./load-typescript.cjs');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { FALLBACK_LESSON } = require('../src/lib/lesson.ts');

function renderReview(tab) {
  const routeModule = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync('src/components/lesson-app.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
    fileName: 'lesson-app.tsx',
  }).outputText;
  const dependencies = {
    react: { ...React, useState: (initial) => React.useState(initial === 'word' ? tab : initial) },
    'next/navigation': { useRouter: () => ({ refresh() {} }) },
    '@/lib/pronunciation': { startPronunciation() {} },
  };
  new Function('require', 'module', 'exports', code)((name) => dependencies[name] || require(name), routeModule, routeModule.exports);
  const base = { phonetic: '', example: '', exampleCn: '', box: 2, hits: 1, misses: 0, graduated: false, dueDate: '2026-11-26' };
  const props = {
    user: { key: 'groot', name: 'groot', level: 'A2' },
    data: {
      lesson: FALLBACK_LESSON, dayIndex: 2,
      review: [
        { ...base, word: 'previous-word-marker', meaning: '旧词', pos: 'n.' },
        { ...base, word: 'Previous sentence marker.', meaning: '旧句子', pos: '句子' },
      ],
    },
  };
  const html = renderToStaticMarkup(React.createElement(routeModule.exports.default, props));
  return html.split('<section>')[1].split('</section>')[0];
}

test('word tab contains only due words and counts the visible category', () => {
  const html = renderReview('word');
  assert.ok(html.includes('previous-word-marker'));
  assert.ok(!html.includes('Previous sentence marker.'));
  assert.ok(html.includes('0 / 1 已复习'));
});

test('sentence tab uses the due historical sentence with its real review state', () => {
  const html = renderReview('sentence');
  assert.ok(html.includes('Previous sentence marker.'));
  assert.ok(!html.includes('previous-word-marker'));
  assert.ok(html.includes('第 2 盒'));
  assert.ok(html.includes('已连续记住 1 次'));
  assert.ok(html.includes('0 / 1 已复习'));
  for (const sentence of FALLBACK_LESSON.reviewSentences) assert.ok(!html.includes(sentence.en));
});
