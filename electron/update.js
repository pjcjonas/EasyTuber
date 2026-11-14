/* Is there a newer EASY-TUBER?

   One GET to GitHub for the latest release of this project. Nothing about the user or the avatar
   is sent: the request holds only the project's public address. It is made only when the editor
   asks (the "Tell me when a new version is out" setting), and at most once every few hours. */
const REPO = 'pjcjonas/EasyTuber';
const API = `https://api.github.com/repos/${REPO}/releases/latest`;
const PAGE = `https://github.com/${REPO}/releases`;

/* "v1.2.3" or "1.2.3" -> [1, 2, 3]; anything else -> null. */
function parse(v) {
  const m = /^v?(\d{1,6})\.(\d{1,6})\.(\d{1,6})$/.exec(String(v == null ? '' : v).trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

/* Is version a newer than version b? False if either can't be read. */
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/* The latest release: { version: '1.2.3', url }, or null if it can't be found out. Never throws. */
async function latest(fetchImpl = globalThis.fetch, timeoutMs = 8000) {
  try {
    const r = await fetchImpl(API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EASY-TUBER' },
      signal: AbortSignal.timeout(timeoutMs), redirect: 'error',
    });
    if (!r.ok) return null;
    const data = await r.json();
    const v = parse(data && data.tag_name);
    if (!v || data.draft || data.prerelease) return null;
    // the link is shown to the user: only ever this project's own releases page
    const url = typeof data.html_url === 'string' && data.html_url.startsWith(PAGE + '/') ? data.html_url : PAGE;
    return { version: v.join('.'), url };
  } catch (e) { return null; }
}

module.exports = { REPO, PAGE, parse, newer, latest };
