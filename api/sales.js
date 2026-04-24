const SQUARE_TOKEN = process.env.SQUARE_ACCESS_TOKEN;
const SQUARE_BASE = 'https://connect.squareup.com/v2';
const LOCATION_ID = 'L8N8572VRDBVN';

const CONSIGNORS = {
  'windsor':   { displayName: 'Windsor Candles',    category: '005 - Windsor Candle Company' },
  'tina':      { displayName: 'Tina VonSeth',        category: '006 - Tina VonSeth' },
  'lisa':      { displayName: 'Lisa Cavalias',       category: '008 - Lisa C' },
  'jackie':    { displayName: 'Jackie Held',         category: '010 - Jackie Held' },
  'robin':     { displayName: 'Robin Marie Studios', category: '014 - Robin Marie Studios' },
  'carrie':    { displayName: 'Carrie Rudd',         category: '110 - Carrie - Maisy Daisy' },
  'paula':     { displayName: 'Paula Nathan',        category: '116 - Paula Nathan' },
  'nancy':     { displayName: 'Nancy Tribbey',       category: '130 - Nancy Tribbey Art' },
  'christine': { displayName: 'Christine Leach',     category: '133 - Christine Leach Notecards' },
  'christina': { displayName: 'Christina Rivera',    category: '138 - Xpressions18' },
  'lakedream': { displayName: 'Lake Dream Designs',  category: '139 - Lake Dream' },
  'pickled':   { displayName: 'Pickled Pottery',     category: '140 - Pickled Pottery' },
  'naked':     { displayName: 'Naked Without It',    category: '141 - Naked Without It' },
  'mike':      { displayName: 'Legacy Woodworks',    category: '865 - Legacy Woodworks' },
  'gilhouse':  { displayName: 'Gilhouse Pottery',    category: '888 - Gilhouse Pottery' },
  'kelly':     { displayName: 'Kelly Krober',        category: '889 - Kelly Krober' },
  'korb':      { displayName: 'Korb Pottery',        category: '890 - Korb Pottery' },
  'ab':        { displayName: 'A|B Pottery',         category: '897 - A|B Pottery' },
  'jessica':   { displayName: 'Jessica Sandacz',     category: '902 - Jessica Sandacz' },
  'sailanew':  { displayName: 'Sail Anew',           category: 'Sail Anew' },
};

function getCommissionRate(net) {
  if (net >= 5000) return 0.30;
  if (net >= 500)  return 0.40;
  return 0.50;
}

function getTierLabel(net) {
  if (net >= 5000) return 'Sales over $5,000 — 30% commission';
  if (net >= 500)  return 'Sales over $500 — 40% commission';
  return 'Sales under $500 — 50% commission';
}

function getMonthRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return {
    start: start.toISOString(),
    end:   end.toISOString(),
    label: start.toLocaleString('default', { month: 'long', year: 'numeric' })
  };
}

function squareHeaders() {
  return {
    'Authorization': `Bearer ${SQUARE_TOKEN}`,
    'Square-Version': '2024-01-18',
    'Content-Type': 'application/json'
  };
}

async function buildCatalogCategoryMap() {
  const categoryNames = {};
  const categoryMap = {};
  let cursor = null;

  do {
    const params = new URLSearchParams({ types: 'CATEGORY', limit: '100', ...(cursor ? { cursor } : {}) });
    const res = await fetch(`${SQUARE_BASE}/catalog/list?${params}`, { headers: squareHeaders() });
    const data = await res.json();
    for (const obj of (data.objects || [])) {
      if (obj.type === 'CATEGORY') {
        categoryNames[obj.id] = obj.category_data?.name || '';
      }
    }
    cursor = data.cursor || null;
  } while (cursor);

  cursor = null;
  do {
    const params = new URLSearchParams({ types: 'ITEM', limit: '100', ...(cursor ? { cursor } : {}) });
    const res = await fetch(`${SQUARE_BASE}/catalog/list?${params}`, { headers: squareHeaders() });
    const data = await res.json();
    for (const obj of (data.objects || [])) {
      if (obj.type !== 'ITEM') continue;
      const item = obj.item_data || {};
      const catId = item.category_id || (item.categories?.[0]?.id);
      const catName = catId ? (categoryNames[catId] || '') : '';
      for (const variation of (item.variations || [])) {
        categoryMap[variation.id] = catName;
      }
    }
    cursor = data.cursor || null;
  } while (cursor);

  return categoryMap;
}

async function fetchOrders(startAt, endAt) {
  let orders = [];
  let cursor = null;

  do {
    const body = {
      location_ids: [LOCATION_ID],
      limit: 100,
      query: {
        filter: {
          date_time_filter: { created_at: { start_at: startAt, end_at: endAt } },
          state_filter: { states: ['COMPLETED'] }
        },
        sort: { sort_field: 'CREATED_AT', sort_order: 'ASC' }
      },
      ...(cursor ? { cursor } : {})
    };

    const res = await fetch(`${SQUARE_BASE}/orders/search`, {
      method: 'POST',
      headers: squareHeaders(),
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (data.orders) orders = orders.concat(data.orders);
    cursor = data.cursor || null;
  } while (cursor);

  return orders;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  const slug = (req.query.artisan || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  if (!slug || !CONSIGNORS[slug]) {
    return res.status(404).json({ error: 'Artisan not found' });
  }

  const consignor = CONSIGNORS[slug];
  const { start, end, label } = getMonthRange();

  try {
    const [catalogMap, orders] = await Promise.all([
      buildCatalogCategoryMap(),
      fetchOrders(start, end)
    ]);

    const transactions = [];

    for (const order of orders) {
      if (!order.line_items) continue;
      const orderDate = (order.created_at || '').split('T')[0];

      for (const item of order.line_items) {
        const variationId = item.catalog_object_id || '';
        const catName = catalogMap[variationId] || '';
        if (catName !== consignor.category) continue;

        transactions.push({
          date:       orderDate,
          item:       item.name || '',
          variation:  item.variation_name || '',
          qty:        parseInt(item.quantity || '1'),
          grossSales: ((item.base_price_money?.amount || 0) * parseInt(item.quantity || '1')) / 100,
          discounts:  (item.total_discount_money?.amount || 0) / 100,
          netSales:   (item.total_money?.amount || 0) / 100,
        });
      }
    }

    const netTotal        = transactions.reduce((s, t) => s + t.netSales, 0);
    const rate            = getCommissionRate(netTotal);
    const estimatedPayout = Math.floor(netTotal * (1 - rate) * 100) / 100;

    return res.status(200).json({
      artisan:          consignor.displayName,
      month:            label,
      netSales:         netTotal,
      commissionRate:   rate,
      tierLabel:        getTierLabel(netTotal),
      estimatedPayout,
      transactionCount: transactions.length,
      transactions
    });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Failed to fetch data: ' + err.message });
  }
};
