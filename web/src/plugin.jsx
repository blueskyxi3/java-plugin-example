import { PluginLoading } from "./loading.jsx";
// Vite builds this entry as an ES module. React and MUI belong to the host SDK.
const sdk = window.AIHubPluginSDK;
const React = sdk.React;
const h = React.createElement;
const { Alert, Box, Button, Chip, Divider, Stack, Typography } = sdk.MUI;
const pluginID = 'java-example';
const namespace = 'java-example';

const messages = {
  zh_CN: {
    title: 'Java 示例', subtitle: 'Spring Boot 插件身份演示', user: '用户 ID',
    role: '示例角色', member: '普通成员', source: '实现来源', badge: 'Java · SDK v2',
    profile: '宿主扩展资料', verified: '后端身份验证结果', loading: '正在验证当前用户…',
    retry: '重新验证', unavailable: '插件资料不可用', notFound: '页面不存在',
    failed: '身份验证请求失败，请重试', inactive: '当前用户无法使用此插件',
    explanation: '资料由宿主身份扩展加载；验证结果来自经过宿主代理和签名校验的插件接口。',
  },
  zh_HK: {
    title: 'Java 範例', subtitle: 'Spring Boot 插件身分示範', user: '使用者 ID',
    role: '範例角色', member: '一般成員', source: '實作來源', badge: 'Java · SDK v2',
    profile: '宿主擴充資料', verified: '後端身分驗證結果', loading: '正在驗證目前使用者…',
    retry: '重新驗證', unavailable: '插件資料無法使用', notFound: '頁面不存在',
    failed: '身分驗證請求失敗，請重試', inactive: '目前使用者無法使用此插件',
    explanation: '資料由宿主身分擴充載入；驗證結果來自經過宿主代理及簽章檢查的插件介面。',
  },
  en_US: {
    title: 'Java example', subtitle: 'Spring Boot plugin identity demo', user: 'User ID',
    role: 'Demo role', member: 'Member', source: 'Implementation', badge: 'Java · SDK v2',
    profile: 'Host enrichment', verified: 'Backend identity verification', loading: 'Verifying current user…',
    retry: 'Verify again', unavailable: 'Plugin profile unavailable', notFound: 'Page not found',
    failed: 'Identity verification failed. Please retry.', inactive: 'This plugin is unavailable for the current user',
    explanation: 'The host loads the enriched profile. Verification calls the plugin API through the host proxy and signature validation.',
  },
  ja_JP: {
    title: 'Java サンプル', subtitle: 'Spring Boot プラグインのユーザー認証デモ', user: 'ユーザー ID',
    role: 'サンプルの役割', member: '一般メンバー', source: '実装', badge: 'Java · SDK v2',
    profile: 'ホストの拡張情報', verified: 'バックエンドの認証結果', loading: '現在のユーザーを確認しています…',
    retry: '再確認', unavailable: 'プラグイン情報を取得できません', notFound: 'ページが見つかりません',
    failed: '認証リクエストに失敗しました。再試行してください。', inactive: '現在のユーザーはこのプラグインを利用できません',
    explanation: '拡張情報はホストから読み込まれます。認証結果はホストのプロキシと署名検証を経由した API から取得します。',
  },
};
for (const [language, resource] of Object.entries(messages)) {
  sdk.i18n?.addResourceBundle(language, namespace, resource, true, true);
}

function language() {
  const value = sdk.i18n?.language || window.navigator?.language || 'zh_CN';
  if (/^en/i.test(value)) return 'en_US';
  if (/^ja/i.test(value)) return 'ja_JP';
  if (/^zh[-_](HK|TW|Hant)/i.test(value)) return 'zh_HK';
  return 'zh_CN';
}

function translate(key) {
  return sdk.i18n?.t(key, { ns: namespace, keySeparator: false })
    || messages[language()][key] || messages.zh_CN[key] || key;
}

function useTranslate() {
  // The hook subscribes both the card and the page to host language changes.
  const translation = sdk.useTranslation?.(namespace);
  return translation?.t || translate;
}

function validProfile(profile) {
  return profile?.active === true && Number.isSafeInteger(profile.user_id) && profile.user_id > 0;
}

export function topNavigation(profile) {
  if (!validProfile(profile)) return [];
  return [{ id: 'example', title: translate('title'), url: `/plugins/${pluginID}`,
    icon: 'tabler:coffee', before: 'about' }];
}

export function ProfileCard({ profile }) {
  const t = useTranslate();
  if (!validProfile(profile)) return null;
  return <Stack spacing={0.5} sx={{ my: 1 }}>
    <Typography variant="caption" color="text.secondary">{t('badge')}</Typography>
    <Typography variant="body2">{t('user')}: {profile.user_id}</Typography>
    <Typography variant="caption" color="text.secondary">{t('role')}: {t('member')}</Typography>
  </Stack>;
}

function ProfileDetails({ profile, t }) {
  return h(Stack, { spacing: 1 },
    h(Typography, null, `${t('user')}: ${profile.user_id}`),
    h(Typography, null, `${t('role')}: ${profile.demo_role === 'member' ? t('member') : profile.demo_role}`),
    h(Typography, { color: 'text.secondary', sx: { overflowWrap: 'anywhere' } },
      `${t('source')}: ${profile.source}`));
}

export function Page({ profile, path = '' }) {
  const t = useTranslate();
  const [attempt, setAttempt] = React.useState(0);
  const [result, setResult] = React.useState(null);
  const [state, setState] = React.useState('loading');
  const available = validProfile(profile);

  React.useEffect(() => {
    if (path || !available) return;
    const abort = new AbortController();
    setState('loading');
    const bases = sdk.getPluginBases(pluginID);
    if (!bases?.apiBase) {
      setState('error');
      return () => abort.abort();
    }
    (async () => {
      try {
        const response = await sdk.API.get(`${bases.apiBase}/self`, { signal: abort.signal });
        if (!response.data?.success || !validProfile(response.data.data)
            || response.data.data.user_id !== profile.user_id) throw new Error('invalid_profile');
        if (!abort.signal.aborted) {
          setResult(response.data.data);
          setState('ready');
        }
      } catch {
        if (!abort.signal.aborted) setState('error');
      }
    })();
    return () => abort.abort();
  }, [profile?.user_id, available, path, attempt]);

  if (path) return h(Alert, { severity: 'info' }, t('notFound'));
  if (!available) return h(Alert, { severity: 'info' }, t('inactive'));

  return h(Box, { sx: { maxWidth: 760, mx: 'auto', width: '100%', py: { xs: 1, sm: 3 } } },
    h(Stack, { spacing: 3 },
      h(Stack, { spacing: 1 },
        h(Chip, { label: t('badge'), size: 'small', variant: 'outlined', sx: { alignSelf: 'flex-start' } }),
        h(Typography, { variant: 'h2', component: 'h1' }, t('title')),
        h(Typography, { color: 'text.secondary' }, t('subtitle')),
        h(Typography, { variant: 'body2', color: 'text.secondary' }, t('explanation'))),
      h(Stack, { spacing: 1.5 },
        h(Typography, { variant: 'h4', component: 'h2' }, t('profile')),
        h(ProfileDetails, { profile, t })),
      h(Divider),
      h(Stack, { spacing: 1.5, 'aria-live': 'polite' },
        h(Typography, { variant: 'h4', component: 'h2' }, t('verified')),
        h(PluginLoading, { key: profile.user_id, loading: state === 'loading', hasData: Boolean(result && result.user_id === profile.user_id), error: state === 'error' ? t('failed') : '', onRetry: () => setAttempt((value) => value + 1), skeleton: 'detail' },
          result && result.user_id === profile.user_id && h(ProfileDetails, { profile: result, t })),
        h(Button, { variant: 'outlined', disabled: state === 'loading',
          onClick: () => setAttempt((value) => value + 1), sx: { alignSelf: 'flex-start' } }, t('retry')))));
}
