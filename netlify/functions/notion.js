'Content-Type': 'application/json'
};

  // ── Helper: fetch with timeout ──
  const fetchWithTimeout = (url, opts, ms = 4000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

try {
    const { token, dbId, fetchBlocks, fetchHighlights, highlightsPageName } = JSON.parse(event.body);
    const { token, dbId, fetchBlocks, fetchHighlights, highlightsPageName,
            blocksLimit = 12,   // only fetch blocks for first N pages
            pageSize = 50       // reduced from 100
          } = JSON.parse(event.body);
const nh = {
'Authorization': `Bearer ${token}`,
'Notion-Version': '2022-06-28',
'Content-Type': 'application/json'
};

    // ── Query main database ──
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST', headers: nh,
      body: JSON.stringify({ page_size: 100 })
    });
    const dbData = await dbRes.json();
    if (!dbRes.ok) throw new Error(dbData.message || `HTTP ${dbRes.status}`);
    // ── Query main database — paginate to get ALL results ──
    let allResults = [];
    let cursor = undefined;
    let hasMore = true;
    while (hasMore) {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const dbRes = await fetchWithTimeout(`https://api.notion.com/v1/databases/${dbId}/query`, {
        method: 'POST', headers: nh,
        body: JSON.stringify(body)
      }, 8000);
      const dbData = await dbRes.json();
      if (!dbRes.ok) throw new Error(dbData.message || `HTTP ${dbRes.status}`);
      allResults = allResults.concat(dbData.results || []);
      hasMore = dbData.has_more;
      cursor = dbData.next_cursor;
    }
    const dbData = { results: allResults };

    // ── Fetch image blocks for each page ──
    // ── Fetch image blocks — only for first `blocksLimit` pages, with timeout ──
if (fetchBlocks && dbData.results) {
      await Promise.all(dbData.results.map(async (page) => {
      // Pages with cover/file already have images — skip block fetch for those
      const needsBlocks = dbData.results.filter(page => {
        if (page.cover) return false; // already has cover image
        for (const k in page.properties) {
          if (page.properties[k].type === 'files' && page.properties[k].files?.length) return false;
        }
        return true;
      }).slice(0, blocksLimit);

      await Promise.all(needsBlocks.map(async (page) => {
try {
          const r = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=50`, { headers: nh });
          const r = await fetchWithTimeout(
            `https://api.notion.com/v1/blocks/${page.id}/children?page_size=20`,
            { headers: nh }, 3000
          );
const d = await r.json();
page._imageBlocks = (d.results || [])
.filter(b => b.type === 'image')
