/*
 * Add‑Ons Widget
 *
 * This script is intended to be injected into your BigCommerce
 * storefront. It dynamically inserts an "Add Something Extra" section
 * above the product page’s Add to Cart button and allows shoppers to
 * select optional add‑on products. When the customer adds the main
 * product to their cart, the selected add‑ons are bundled into the
 * cart via the Storefront API.
 *
 * To use this script:
 *   1. Host it at a publicly accessible URL (e.g. your app
 *      server). In the examples below we assume it is served from
 *      /public/add‑ons-widget.js on the same domain as the backend.
 *   2. Use BigCommerce’s Script Manager or the App Extension APIs to
 *      inject the script into the Product Details Page. Make sure
 *      that it runs after BCData has been populated.
 */

(() => {
  // Helper to create DOM elements with attributes and children
  function h(tag, attrs = {}, children = []) {
    const el = document.createElement(tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (key === 'class') el.className = value;
      else el.setAttribute(key, value);
    });
    children.forEach(child => {
      if (typeof child === 'string') el.appendChild(document.createTextNode(child));
      else el.appendChild(child);
    });
    return el;
  }

  async function fetchAddOns(productId) {
    // Adjust the base URL if your backend is hosted elsewhere
    const url = `/api/addons/${productId}`;
    const res = await fetch(url);
    if (!res.ok) {
      console.error('Failed to fetch add‑ons');
      return [];
    }
    const data = await res.json();
    return data.addons || [];
  }

  function renderAddOnUI(addons) {
    const container = h('div', { id: 'add-ons-widget', class: 'add-ons-widget' });
    if (!addons || addons.length === 0) return null;
    container.appendChild(h('h3', {}, ['Add Something Extra']));
    addons.forEach(item => {
      const label = h('label', { class: 'add-ons-option' }, [
        (() => {
          const input = h('input', {
            type: 'checkbox',
            'data-product-id': item.product_id,
            'data-variant-id': item.variant_id
          });
          return input;
        })(),
        ` ${item.name || 'Product ' + item.product_id}` +
        (item.price ? ` (+$${item.price})` : '')
      ]);
      container.appendChild(label);
    });
    return container;
  }

  function interceptAddToCart(form, addonsContainer) {
    form.addEventListener('submit', async (e) => {
      const selected = addonsContainer.querySelectorAll('input[type="checkbox"]:checked');
      if (!selected.length) return; // No add‑ons selected
      e.preventDefault();
      // Build line items for main product and add‑ons
      const formData = new FormData(form);
      const quantity = parseInt(formData.get('qty[]') || '1', 10);
      const mainVariantId = window.BCData.product.variants[0]?.id || null;
      const lineItems = [];
      lineItems.push({
        product_id: window.BCData.product.id,
        variant_id: mainVariantId,
        quantity
      });
      selected.forEach(input => {
        lineItems.push({
          product_id: parseInt(input.getAttribute('data-product-id'), 10),
          variant_id: parseInt(input.getAttribute('data-variant-id'), 10),
          quantity: 1
        });
      });
      try {
        await fetch('/api/storefront/cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ line_items: lineItems })
        });
        window.location.href = '/cart.php';
      } catch (err) {
        console.error('Failed to add to cart', err);
      }
    });
  }

  async function init() {
    const productId = window.BCData?.product?.id;
    if (!productId) return;
    const addons = await fetchAddOns(productId);
    const ui = renderAddOnUI(addons);
    if (!ui) return;
    const form = document.querySelector('form[action="/cart.php"]');
    if (!form) return;
    form.parentNode.insertBefore(ui, form);
    interceptAddToCart(form, ui);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
