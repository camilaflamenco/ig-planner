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
            blocksLimit = 12,
            pageSize = 100
          } = JSON.parse(event.body);

    // ── Headers for new API version ──
    const nh = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json'
    };

    // ── Step 1: Get data_source_id from database ──
    // New API requires querying data_sources instead of databases directly
    let dataSourceId = null;
    try {
      const dbInfoRes = await fetchWithTimeout(
        `https://api.notion.com/v1/databases/${dbId}`,
        { method: 'GET', headers: nh },
        5000
      );
      const dbInfo = await dbInfoRes.json();
      // The new API returns data_sources array; use the first one
      if (dbInfo.data_sources && dbInfo.data_sources.length > 0) {
        dataSourceId = dbInfo.data_sources[0].id;
      }
    } catch (e) {
      // If this fails, fall back to old endpoint
      dataSourceId = null;
    }

    // ── Step 2: Query using data_source_id (new) or database_id (fallback) ──
    let allResults = [];
    let cursor = undefined;
    let hasMore = true;

    while (hasMore) {
      const body = { page_size: pageSize };
      if (cursor) body.start_cursor = cursor;

      let queryRes, queryData;

      if (dataSourceId) {
        // New endpoint: PATCH /v1/data_sources/:data_source_id/query
        queryRes = await fetchWithTimeout(
          `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
          { method: 'PATCH', headers: nh, body: JSON.stringify(body) },
          8000
        );
      } else {
        // Fallback: old endpoint for backwards compatibility
        queryRes = await fetchWithTimeout(
          `https://api.notion.com/v1/databases/${dbId}/query`,
          { method: 'POST', headers: nh, body: JSON.stringify(body) },
          8000
        );
      }

      queryData = await queryRes.json();
      if (!queryRes.ok) throw new Error(queryData.message || `HTTP ${queryRes.status}`);

      allResults = allResults.concat(queryData.results || []);
      hasMore = queryData.has_more;
      cursor = queryData.next_cursor;
    }

    const dbData = { results: allResults };

    // ── Fetch image blocks — only for first `blocksLimit` pages ──
    if (fetchBlocks && dbData.results) {
      const needsBlocks = dbData.results.filter(page => {
        if (page.cover) return false;
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
              const caption = b.image?.caption?.map(c => c.plain_text).join('').trim();
              let label = caption;
              if (!label && url) {
                try {
                  const path = new URL(url).pathname;
                  const raw  = decodeURIComponent(path.split('/').pop()).replace(/\.[^.]+$/, '');
                  label = raw.replace(/[-_]/g, ' ').replace(/\s+\d{5,}$/, '').trim();
                } catch { label = 'Story'; }
              }
              return url ? { url, label: label || 'Story' } : null;
            })
            .filter(Boolean);
        } catch { dbData._highlights = []; }
      } else {
        dbData._highlights = null;
      }
    }

    return { statusCode: 200, headers, body: JSON.stringify(dbData) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: e.message }) };
  }
};
