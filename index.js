const express = require('express');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory storage for manual add-on mappings: { productId: [{ product_id, variant_id }, ...] }.
let addOnMappings = {};

async function fetchFromBigCommerce(query, variables = {}) {
  const token = process.env.BIGCOMMERCE_STOREFRONT_API_TOKEN;
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  if (!token || !storeHash) {
    throw new Error('Missing BigCommerce API credentials.');
  }
  const endpoint = `https://store-${storeHash}.mybigcommerce.com/graphql`;

  const fetchFn = (typeof fetch === 'function')
    ? fetch
    : (await import('node-fetch')).default;

  const res = await fetchFn(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ query, variables })
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

app.get('/api/addons/:productId', async (req, res) => {
  const productId = parseInt(req.params.productId, 10);
  const manualAddons = addOnMappings[productId] || [];

  // If manual mappings exist, format and return them.
  if (manualAddons.length > 0) {
    const addons = manualAddons.map(item => ({
      product_id: item.product_id,
      variant_id: item.variant_id || null,
      name: null,
      price: null
    }));
    return res.json({ addons });
  }

  // Otherwise, use category-driven logic if ADD_ON_CATEGORY_ID is provided.
  const categoryId = process.env.ADD_ON_CATEGORY_ID;
  if (categoryId) {
    try {
      const query = `
        query ProductsByCategory($categoryId: Int!) {
          site {
            products(first: 50, filter: { categoryEntityId: $categoryId }) {
              edges {
                node {
                  entityId
                  name
                  prices {
                    price {
                      value
                    }
                  }
                  variants(first: 1) {
                    edges {
                      node {
                        entityId
                      }
                    }
                  }
                }
              }
            }
          }
        }
      `;
      const data = await fetchFromBigCommerce(query, { categoryId: parseInt(categoryId, 10) });
      const products = data.site.products.edges || [];
      const addons = products
        .filter(edge => edge.node.entityId !== productId)
        .map(edge => {
          const variantId = edge.node.variants.edges[0]?.node.entityId || null;
          return {
            product_id: edge.node.entityId,
            variant_id: variantId,
            name: edge.node.name,
            price: edge.node.prices.price.value
          };
        });
      return res.json({ addons });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Failed to fetch add-ons from BigCommerce' });
    }
  }

  // No manual mappings and no category specified.
  res.json({ addons: [] });
});

app.post('/api/settings', (req, res) => {
  const { product_id, addons } = req.body;
  if (!product_id || !Array.isArray(addons)) {
    return res.status(400).json({ error: 'Invalid payload. Expected { product_id, addons }.' });
  }
  addOnMappings[product_id] = addons;
  res.json({ status: 'ok' });
});

// Example endpoint to fetch product details by id using BigCommerce Storefront API.
app.get('/api/bc/products/:id', async (req, res) => {
  const productId = parseInt(req.params.id, 10);
  if (!productId) {
    return res.status(400).json({ error: 'Invalid product id' });
  }
  try {
    const query = `
      query ProductById($productId: Int!) {
        site {
          product(entityId: $productId) {
            entityId
            name
            plainTextDescription
            prices {
              price {
                value
              }
            }
            variants(first: 1) {
              edges {
                node {
                  entityId
                }
              }
            }
          }
        }
      }
    `;
    const data = await fetchFromBigCommerce(query, { productId });
    const product = data.site.product;
    res.json(product);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

// Health/root endpoint
app.get('/', (req, res) => {
  res.send('BigCommerce Add-ons App Server');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
