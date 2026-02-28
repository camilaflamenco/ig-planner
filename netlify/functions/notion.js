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

  const fetchWithTimeout = (url, opts, ms = 8000) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ms);
    return fetch(url, { ...opts, signal: ctrl.signal }).finally(() => clearTimeout(timer));
  };

  // ── Query all pages with full pagination ──
  const queryAll = async (url, method, nhHeaders, pageSize) => {
    let allResults = [];
    let cursor = undefined;
    let hasMore = true;
    while (hasMore) {
      const body = { page_size: pageSize };
      if (cursor) body.start_cursor = cursor;
      const res = await fetchWithTimeout(url, {
        method, headers: nhHeaders, body: JSON.stringify(body)
      }, 8000);
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
      allResults = allResults.concat(data.results || []);
      hasMore = data.has_more;
      cursor = data.next_cursor;
    }
    return allResults;
  };

  try {
    const { token, dbId, fetchBlocks, fetchHighlights, highlightsPageName,
            blocksLimit = 12,
            pageSize = 100
          } = JSON.parse(event.body);

    // ── Try new API (2025-09-03) first, fall back to old (2022-06-28) ──
    const nhNew = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2025-09-03',
      'Content-Type': 'application/json'
    };
    const nhOld = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    let allResults = [];
    let usedNewApi = false;

    // Step 1: Try to get data_source_id from new API
    try {
      const dbInfoRes = await fetchWithTimeout(
        `https://api.notion.com/v1/databases/${dbId}`,
        { method: 'GET', headers: nhNew },
        5000
      );
      const dbInfo = await dbInfoRes.json();

      if (dbInfoRes.ok && dbInfo.data_sources && dbInfo.data_sources.length > 0) {
        const dataSourceId = dbInfo.data_sources[0].id;
        // Step 2: Query with new endpoint
        allResults = await queryAll(
          `https://api.notion.com/v1/data_sources/${dataSourceId}/query`,
          'PATCH', nhNew, pageSize
        );
        usedNewApi = true;
      }
    } catch (e) {
      // new API failed, will use fallback below
    }

    // Fallback: old API
    if (!usedNewApi) {
      allResults = await queryAll(
        `https://api.notion.com/v1/databases/${dbId}/query`,
        'POST', nhOld, pageSize
      );
    }

    const nhActive = usedNewApi ? nhNew : nhOld;
    const dbData = { results: allResults };

    // ── Fetch image blocks ──
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
            { headers: nhActive }, 3000
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
          const r = await fetch(
            `https://api.notion.com/v1/blocks/${hlPage.id}/children?page_size=100`,
            { headers: nhActive }
          );
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
