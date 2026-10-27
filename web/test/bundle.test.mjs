import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from 'i18next';

const MUI = createRequire(import.meta.url)('@mui/material');
const entry = new URL('../build/assets/plugin.js', import.meta.url);

test('built ES module runs against the host SDK and preserves all extension exports', async () => {
  await i18n.init({ lng: 'zh_CN', fallbackLng: 'zh_CN', resources: {} });
  globalThis.window = { AIHubPluginSDK: { React, MUI, i18n } };
  try {
    const plugin = await import(entry.href);
    assert.deepEqual(Object.keys(plugin).sort(), ['Page', 'ProfileCard', 'topNavigation']);
    const profile = { user_id: 123, active: true, demo_role: 'member', source: 'spring-boot' };
    assert.equal(plugin.topNavigation(profile)[0].url, '/plugins/java-example');
    assert.equal(plugin.topNavigation(profile)[0].title, 'Java 示例');
    const card = renderToStaticMarkup(React.createElement(plugin.ProfileCard, { profile }));
    assert.match(card, /Java · SDK v2/);
    assert.match(card, /123/);
    assert.match(card, /普通成员/);
    const initialPage = renderToStaticMarkup(React.createElement(plugin.Page, { profile }));
    assert.match(initialPage, /aria-busy="true"/);
    assert.match(initialPage, /MuiSkeleton-root/);
    assert.doesNotMatch(initialPage, /MuiCircularProgress/);
    assert.match(renderToStaticMarkup(React.createElement(plugin.Page, { profile, path: 'missing' })), /页面不存在/);
    const inactive = { ...profile, active: false };
    assert.deepEqual(plugin.topNavigation(inactive), []);
    assert.equal(renderToStaticMarkup(React.createElement(plugin.ProfileCard, { profile: inactive })), '');
    await i18n.changeLanguage('en_US');
    assert.equal(plugin.topNavigation(profile)[0].title, 'Java example');
    assert.match(renderToStaticMarkup(React.createElement(plugin.ProfileCard, { profile })), /Member/);
  } finally {
    delete globalThis.window;
  }
});

test('production bundle excludes the standalone shell and development credentials', async () => {
  const script = await readFile(entry, 'utf8');
  assert(!script.includes('Java 插件独立调试'));
  assert(!script.includes('/__dev/'));
  assert(!script.includes('JAVA_EXAMPLE_HOST_SECRET'));
  assert(!script.includes('X-AIHub-Plugin-Secret'));
  // React and MUI are supplied by the host; neither library belongs in this bundle.
  assert(script.length < 30_000);
});
