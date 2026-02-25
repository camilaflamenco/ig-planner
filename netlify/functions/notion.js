exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json'
  };

  // ── Helper: fetch with timeout ──
  const fetchWithTimeout = (url, opts, ms = 4000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  try {
    const { token, dbId, fetchBlocks, fetchHighlights, highlightsPageName,
            blocksLimit = 12,   // only fetch blocks for first N pages
            pageSize = 50       // reduced from 100
          } = JSON.parse(event.body);
    const nh = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

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

    // ── Fetch image blocks — only for first `blocksLimit` pages, with timeout ──
    if (fetchBlocks && dbData.results) {
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
          const r = await fetchWithTimeout(
            `https://api.notion.com/v1/blocks/${page.id}/children?page_size=20`,
            { headers: nh }, 3000
          );
          const d = await r.json();
          page._imageBlocks = (d.results || [])
            .filter(b => b.type === 'image')
            .map(b => {
              const isExt = b.image?.type === 'external';
              const url   = isExt ? b.image.external.url : b.image?.file?.url;
              const name  = b.image?.name || '';
              return url ? { url, name } : null;
            })
            .filter(Boolean);
        } catch { page._imageBlocks = []; }
      }));
    }

    // ── Fetch Highlights page ──
    if (fetchHighlights && dbData.results) {
      // Find highlights page — matches any page whose title CONTAINS the search term
      const searchTerm = (highlightsPageName || 'highlights').toLowerCase().trim();
      const hlPage = dbData.results.find(p => {
        for (const k in p.properties) {
          if (p.properties[k].type === 'title') {
            const t = p.properties[k].title?.map(t => t.plain_text).join('').trim().toLowerCase();
            return t.includes(searchTerm) || searchTerm.includes(t);
          }
        }
        return false;
      });

      if (hlPage) {
        try {
          const r = await fetch(`https://api.notion.com/v1/blocks/${hlPage.id}/children?page_size=100`, { headers: nh });
          const d = await r.json();

          dbData._highlights = (d.results || [])
            .filter(b => b.type === 'image')
            .map(b => {
              const isExt = b.image?.type === 'external';
              const url   = isExt ? b.image.external.url : b.image?.file?.url;
              // Try to get caption as label, fallback to filename from URL
              const caption = b.image?.caption?.map(c => c.plain_text).join('').trim();
              let label = caption;
              if (!label && url) {
                try {
                  const path = new URL(url).pathname;
                  const raw  = decodeURIComponent(path.split('/').pop()).replace(/\.[^.]+$/, '');
                  // Clean up S3-style names like "My-Photo-123456789"
                  label = raw.replace(/[-_]/g, ' ').replace(/\s+\d{5,}$/, '').trim();
                } catch { label = 'Story'; }
              }
              return url ? { url, label: label || 'Story' } : null;
            })
            .filter(Boolean);
        } catch { dbData._highlights = []; }
      } else {
        dbData._highlights = null; // signal: no Highlights page found
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify(dbData) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: e.message }) };
  }
};
