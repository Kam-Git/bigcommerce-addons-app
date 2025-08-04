// A simple Express server for the Add-Ons BigCommerce app.
//
// This server exposes two core APIs:
//   - GET /api/addons/:productId
//       Returns the list of add-on products associated with a specific product.
//   - POST /api/settings
//       Allows you to configure add-on rules via a JSON payload.
//
// Additionally, there's an example endpoint to demonstrate how you might
// fetch product data from the BigCommerce Storefront API using a
// Storefront API token. That endpoint is disabled by default and
// provided purely as a reference.

const express = require('express');
const fetch = require('node-fetch');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// Serve static files from the public directory. This makes
// /public/add-ons-widget.js available when the app is hosted.
app.use('/public', express.static(path.join(__dirname, 'public')));

// Parse JSON bodies
app.use(express.json());

// In-memory storage for product → add-ons mappings. In a real app you
// should persist this data in a database like MongoDB, Firestore or
// Supabase.
const addOnMappings = {
  // Example structure:
  // '101': [
  //   { product_id: 111, variant_id: 222 },
  //   { product_id: 113, variant_id: 225 }
  // ],
};

/**
 * GET /api/addons/:productId
 *
 * Returns a list of add-on products for the given product. There are
 * two modes of operation:
 *
 * 1. **Manual mapping** – If an entry exists in `addOnMappings`, that
 *    array will be returned.
 * 2. **Category-driven** – If the environment variable
 *    `ADD_ON_CATEGORY_ID` is set and no manual mapping exists, this
 *    handler will query the BigCommerce Storefront API to retrieve
 *    products in the specified category. The calling store must have
 *    granted the app the ability to generate Storefront API tokens.
 */
app.get('/api/addons/:productId', async (req, res) => {
  const { productId } = req.params;
  // If a manual mapping exists, return it immediately
  if (addOnMappings[productId]) {
    return res.json({ addons: addOnMappings[productId] });
  }
  const categoryId = process.env.ADD_ON_CATEGORY_ID;
  const storefrontToken = process.env.BIGCOMMERCE_STOREFRONT_API_TOKEN;
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  if (!categoryId || !storefrontToken || !storeHash) {
    // If no category or token configured, fall back to empty list
    return res.json({ addons: [] });
  }
  try {
    // GraphQL query to fetch products from a category
    const query = `
      query ProductsByCategory($categoryId: Int!) {
        site {
          category(entityId: $categoryId) {
            products(first: 50) {
              edges {
                node {
                  entityId
                  name
                  prices {
                    price {
                      value
                      currencyCode
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
      }
    `;
    const url = `https://store-${storeHash}.mybigcommerce.com/graphql`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${storefrontToken}`
      },
      body: JSON.stringify({ query, variables: { categoryId: parseInt(categoryId, 10) } })
    });
    const json = await response.json();
    const edges = json?.data?.site?.category?.products?.edges || [];
    // Transform products into add-on objects expected by the widget
    const addons = edges
      .map(({ node }) => {
        const variantEdge = node.variants.edges[0];
        return {
          product_id: node.entityId,
          variant_id: variantEdge?.node?.entityId || null,
          name: node.name,
          price: node.prices.price?.value || null
        };
      })
      // Filter out the product itself if it happens to be in the add-on category
      .filter(item => item.product_id !== parseInt(productId, 10));
    res.json({ addons });
  } catch (err) {
  
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch add-ons from BigCommerce' });
  }

/**
 * POST /api/settings
 *
 * Accepts a JSON body of the form:
 *   {
 *     "product_id": <number>,
 *     "addons": [
 *       { "product_id": <number>, "variant_id": <number> },
 *       ...
 *     ]
 *   }
 *
 * Stores the mapping in memory. In a real app you would authenticate
 * requests, persist the mapping and maybe validate that the product
 * and variant IDs exist.
 */
app.post('/api/settings', (req, res) => {
  const { product_id, addons } = req.body;
  if (!product_id || !Array.isArray(addons)) {
    return res.status(400).json({ error: 'Invalid payload' });
  }
  addOnMappings[product_id] = addons;
  res.json({ success: true });
});

/**
 * OPTIONAL: GET /api/bc/products/:id
 *
 * This example demonstrates how to fetch product data from the
 * BigCommerce Storefront API using a token. You will need to set
 * BIGCOMMERCE_STOREFRONT_API_TOKEN and BIGCOMMERCE_STORE_HASH in
 * your .env file. The Storefront API token can be generated via
 * the BigCommerce Control Panel (Storefront API Tokens scope).
 */
app.get('/api/bc/products/:id', async (req, res) => {
  const token = process.env.BIGCOMMERCE_STOREFRONT_API_TOKEN;
  const storeHash = process.env.BIGCOMMERCE_STORE_HASH;
  if (!token || !storeHash) {
    return res.status(501).json({ error: 'Storefront API not configured' });
  }
  const { id } = req.params;
  const url = `https://store-${storeHash}.mybigcommerce.com/graphql`;
  const query = `
    query Product($id: Int!) {
      site {
        product(entityId: $id) {
          entityId
          name
          sku
          prices {
            price {
              value
              currencyCode
            }
          }
          images {
            edges {
              node {
                url(width: 200, height: 200)
                altText
              }
            }
          }
          variants(first: 50) {
            edges {
              node {
                entityId
                sku
                defaultImage {
                  url(width: 200, height: 200)
                }
                prices {
                  price {
                    value
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ query, variables: { id: parseInt(id, 10) } })
    });
    const result = await response.json();
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch product' });
  }
});

app.get('/', (_req, res) => {
  res.send('BigCommerce Add-Ons app is running.');
});

app.listen(port, () => {
  console.log(`Add-Ons app listening on port ${port}`);
});

});
