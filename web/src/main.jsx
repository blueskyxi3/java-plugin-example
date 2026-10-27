import React from 'react';
import { createRoot } from 'react-dom/client';
import * as MUI from '@mui/material';
import axios from 'axios';
import i18n from 'i18next';
import { initReactI18next, I18nextProvider, useTranslation } from 'react-i18next';
import { BrowserRouter, useLocation, useNavigate } from 'react-router-dom';

const { Alert, Box, Button, Chip, Container, CssBaseline, FormControlLabel, MenuItem,
  Paper, Stack, Switch, TextField, ThemeProvider, Typography, createTheme } = MUI;
const root = createRoot(document.getElementById('root'));

async function start() {
  const response = await fetch('/__dev/config');
  if (!response.ok) throw new Error('无法读取本地调试配置');
  const config = await response.json();
  await i18n.use(initReactI18next).init({
    lng: 'zh_CN', fallbackLng: 'zh_CN', resources: {}, interpolation: { escapeValue: false },
  });
  window.AIHubPluginSDK = {
    version: 2, React, MUI, API: axios.create(), i18n, useTranslation, useNavigate,
    getPluginBases: (id) => id === config.pluginID
      ? { apiBase: config.apiBase, assetBase: config.assetBase } : undefined,
  };
  // Install the local SDK before evaluating the real plugin entry.
  const plugin = await import(/* @vite-ignore */ config.entryURL);
  root.render(<I18nextProvider i18n={i18n}><BrowserRouter><App config={config} plugin={plugin} /></BrowserRouter></I18nextProvider>);
}

function App({ config, plugin }) {
  useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [theme, setTheme] = React.useState('light');
  const [profile, setProfile] = React.useState(null);
  const [inactive, setInactive] = React.useState(false);
  const [error, setError] = React.useState('');
  const [attempt, setAttempt] = React.useState(0);
  const [draft, setDraft] = React.useState('');
  const pageBase = config.pageBase;
  const path = location.pathname.startsWith(pageBase + '/')
    ? location.pathname.slice(pageBase.length + 1) : '';
  React.useEffect(() => {
    if (location.pathname === '/') navigate(pageBase, { replace: true });
  }, [location.pathname, navigate, pageBase]);
  React.useEffect(() => { setDraft(path); }, [path]);
  React.useEffect(() => {
    const abort = new AbortController();
    setError('');
    setProfile(null);
    (async () => {
      try {
        const response = await fetch('/__dev/profile', { signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.message || '读取资料失败');
        if (!abort.signal.aborted) setProfile(body);
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure.message);
      }
    })();
    return () => abort.abort();
  }, [attempt]);
  const current = profile ? { ...profile, active: profile.active && !inactive } : null;
  const entries = current ? plugin.topNavigation?.(current) || [] : [];
  const Page = plugin.Page;
  const ProfileCard = plugin.ProfileCard;
  return <ThemeProvider theme={createTheme({ palette: { mode: theme } })}><CssBaseline />
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack spacing={3}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <Typography variant="h5" component="h1">Java 插件独立调试</Typography>
          <Chip size="small" label={config.mock ? '纯前端模拟' : '真实后端联调'} color={config.mock ? 'default' : 'success'} />
        </Stack>
        <Typography variant="body2" color="text.secondary">
          {config.mock ? '当前 API 和用户资料为本地模拟数据。' : `后端：${config.backendURL} · 身份签名由本地代理生成。`}
          {' '}修改 web/src/plugin.jsx 后自动刷新，支持 JSX 和拆分组件。
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} flexWrap="wrap" useFlexGap>
          <TextField select size="small" label="界面语言" value={i18n.language} sx={{ minWidth: 150 }}
            onChange={(event) => i18n.changeLanguage(event.target.value)}>
            {[['zh_CN', '简体中文'], ['zh_HK', '繁體中文'], ['en_US', 'English'], ['ja_JP', '日本語']]
              .map(([value, title]) => <MenuItem key={value} value={value}>{title}</MenuItem>)}
          </TextField>
          <FormControlLabel label="深色主题" control={<Switch checked={theme === 'dark'} onChange={(_, value) => setTheme(value ? 'dark' : 'light')} />} />
          <FormControlLabel label="模拟无效资料" control={<Switch checked={inactive} onChange={(_, value) => setInactive(value)} />} />
          <Button variant="outlined" onClick={() => setAttempt((value) => value + 1)}>重新读取资料</Button>
        </Stack>
        <Stack component="nav" direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {entries.map((entry) => <Button key={entry.id} variant="text" onClick={() => navigate(entry.url)}>{entry.title}</Button>)}
        </Stack>
        <Box component="form" onSubmit={(event) => { event.preventDefault(); navigate(`${pageBase}${draft ? '/' + draft.replace(/^\/+/, '') : ''}`); }}>
          <Stack direction="row" spacing={1}>
            <TextField size="small" fullWidth label="插件子路径（留空为首页）" value={draft} onChange={(event) => setDraft(event.target.value)} />
            <Button type="submit" variant="outlined">打开</Button>
          </Stack>
        </Box>
        {error && <Alert severity="error">{error}</Alert>}
        {!profile && !error && <Typography>正在读取插件资料…</Typography>}
        {current && <Box sx={{ display: 'grid', gap: 3, gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'minmax(0, 1fr) minmax(0, 3fr)' } }}>
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Typography variant="subtitle2">资料卡片预览</Typography>
              {ProfileCard && <ProfileCard profile={current} />}
              <Typography variant="caption" color="text.secondary">模拟用户 ID：{config.userID}</Typography>
            </Paper>
            <Paper variant="outlined" sx={{ minWidth: 0, p: { xs: 2, sm: 3 } }}>
              {Page ? <Page profile={current} path={path} /> : <Alert severity="error">src/plugin.jsx 未导出 Page</Alert>}
            </Paper>
        </Box>}
      </Stack>
    </Container>
  </ThemeProvider>;
}

start().catch((error) => {
  root.render(<Container sx={{ py: 4 }}><Alert severity="error">
    插件入口加载失败：{error.message}。请检查 src/plugin.jsx 的导出、组件引用及浏览器控制台。
  </Alert></Container>);
});
