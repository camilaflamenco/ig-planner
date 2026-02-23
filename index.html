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

  try {
    const { token, dbId, fetchBlocks } = JSON.parse(event.body);
    const notionHeaders = {
      'Authorization': `Bearer ${token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json'
    };

    // Query the database
    const dbRes = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
      method: 'POST',
      headers: notionHeaders,
      body: JSON.stringify({ page_size: 100 })
    });
    const dbData = await dbRes.json();
    if (!dbRes.ok) throw new Error(dbData.message || `HTTP ${dbRes.status}`);

    // Optionally fetch image blocks for each page
    if (fetchBlocks && dbData.results) {
      await Promise.all(dbData.results.map(async (page) => {
        try {
          const blocksRes = await fetch(`https://api.notion.com/v1/blocks/${page.id}/children?page_size=50`, {
            headers: notionHeaders
          });
          const blocksData = await blocksRes.json();
          // Extract image URLs from image blocks
          page._imageBlocks = (blocksData.results || [])
            .filter(b => b.type === 'image')
            .map(b => b.image?.type === 'external' ? b.image.external.url : b.image?.file?.url)
            .filter(Boolean);
        } catch(e) {
          page._imageBlocks = [];
        }
      }));
    }

    return { statusCode: 200, headers, body: JSON.stringify(dbData) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ message: e.message }) };
  }
};
