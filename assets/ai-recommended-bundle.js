(() => {
  const SELECTOR = '[data-ai-bundle]';
  const CACHE_TTL = 15 * 60 * 1000;
  const debounce = (fn, wait = 250) => {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), wait);
    };
  };

  class AIBundle {
    constructor(root) {
      this.root = root;
      this.status = root.querySelector('[data-bundle-status]');
      this.skeleton = root.querySelector('[data-bundle-skeleton]');
      this.content = root.querySelector('[data-bundle-content]');
      this.grid = root.querySelector('[data-bundle-grid]');
      this.reason = root.querySelector('[data-bundle-reason]');
      this.message = root.querySelector('[data-bundle-message]');
      this.addAllButton = root.querySelector('[data-add-entire-bundle]');
      this.product = this.parseJSON('[data-product-context]', {});
      this.fallbackProducts = this.parseJSON('[data-fallback-products]', []);
      this.endpoint = root.dataset.aiEndpoint;
      this.limit = Number(root.dataset.recommendationCount || 4);
      this.mainVariantId = Number(root.dataset.productVariantId);
      this.products = [];
      this.currency = window.Shopify?.currency?.active || 'USD';
      this.abortController = null;
      this.init();
    }

    parseJSON(selector, fallback) {
      const node = this.root.querySelector(selector);
      if (!node) return fallback;
      try { return JSON.parse(node.textContent); }
      catch (error) { console.warn('AI Bundle: invalid JSON', error); return fallback; }
    }

    async init() {
      this.addAllButton?.addEventListener('click', () => this.addEntireBundle());
      this.grid?.addEventListener('click', (event) => this.handleGridClick(event));
      this.grid?.addEventListener('change', debounce((event) => this.handleVariantChange(event), 150));

      try {
        const ai = await this.getAIRecommendations();
        const matched = await this.matchProducts(ai.recommendations || []);
        if (!matched.length) {
          this.renderFallback('We could not match AI suggestions with available products. Showing popular alternatives.');
          return;
        }
        this.products = matched.slice(0, this.limit);
        this.render(this.products, ai.reason || 'Complete your stack with these complementary products.');
      } catch (error) {
        console.warn('AI Bundle recommendation flow failed:', error);
        this.renderFallback('Recommendations are temporarily unavailable. Here are some products you may like.');
      }
    }

    cacheKey() {
      return `ai-bundle:${this.product.handle}:${this.limit}`;
    }

    readCache() {
      try {
        const cached = JSON.parse(sessionStorage.getItem(this.cacheKey()));
        if (cached && Date.now() - cached.createdAt < CACHE_TTL) return cached.data;
      } catch (_) {}
      return null;
    }

    writeCache(data) {
      try {
        sessionStorage.setItem(this.cacheKey(), JSON.stringify({ createdAt: Date.now(), data }));
      } catch (_) {}
    }

    async getAIRecommendations() {
      const cached = this.readCache();
      if (cached) return cached;
      if (!this.endpoint) throw new Error('AI endpoint is not configured');

      this.abortController?.abort();
      this.abortController = new AbortController();
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product: this.product,
          recommendationCount: this.limit
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) throw new Error(`AI API failed with ${response.status}`);
      const data = await response.json();
      if (!Array.isArray(data.recommendations) || !data.recommendations.length) {
        throw new Error('Empty AI response');
      }
      this.writeCache(data);
      return data;
    }

    async matchProducts(recommendations) {
      const unique = [...new Set(recommendations.map(item =>
        typeof item === 'string' ? item : item?.name
      ).filter(Boolean))].slice(0, this.limit * 2);

      const settled = await Promise.allSettled(unique.map(name => this.searchProduct(name)));
      const seen = new Set();
      return settled
        .filter(result => result.status === 'fulfilled' && result.value)
        .map(result => result.value)
        .filter(product => {
          if (!product.available || product.handle === this.product.handle || seen.has(product.id)) return false;
          seen.add(product.id);
          return true;
        });
    }

    async searchProduct(query) {
      const url = `${window.Shopify.routes.root}search/suggest.json?q=${encodeURIComponent(query)}&resources[type]=product&resources[limit]=6&resources[options][unavailable_products]=hide`;
      const response = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('Shopify predictive search failed');
      const data = await response.json();
      const products = data?.resources?.results?.products || [];
      const normalized = query.toLowerCase();
      return products.find(product => product.title.toLowerCase().includes(normalized))
        || products[0]
        || null;
    }

    renderFallback(message) {
      const products = this.fallbackProducts.filter(product => product.available).slice(0, this.limit);
      if (!products.length) {
        this.showMessage('We could not load bundle recommendations right now. Please try again later.');
        return;
      }
      this.products = products;
      this.render(products, message);
    }

    money(cents) {
      if (window.Shopify?.formatMoney) return window.Shopify.formatMoney(cents);
      return new Intl.NumberFormat(document.documentElement.lang || 'en', {
        style: 'currency',
        currency: this.currency
      }).format(Number(cents || 0) / 100);
    }

    escapeHTML(value = '') {
      const div = document.createElement('div');
      div.textContent = String(value);
      return div.innerHTML;
    }

    imageFor(product) {
      return product.featured_image?.url || product.featured_image || product.image || '';
    }

    productUrl(product) {
      return product.url || `${window.Shopify.routes.root}products/${product.handle}`;
    }

    availableVariants(product) {
      return (product.variants || []).filter(variant => variant.available !== false);
    }

    cardTemplate(product, index) {
      const variants = this.availableVariants(product);
      const first = variants[0];
      const image = this.imageFor(product);
      const variantOptions = variants.map(variant =>
        `<option value="${variant.id}" data-price="${variant.price ?? product.price}">${this.escapeHTML(variant.title)}</option>`
      ).join('');
      const showSelector = variants.length > 1 || (first && first.title !== 'Default Title');

      return `
        <article class="ai-bundle__card" data-product-card data-index="${index}">
          <label class="ai-bundle__select-wrap">
            <input class="ai-bundle__checkbox" type="checkbox" data-product-select checked aria-label="Select ${this.escapeHTML(product.title)}">
            <span>Select</span>
          </label>
          <a class="ai-bundle__image-link" href="${this.escapeHTML(this.productUrl(product))}">
            ${image ? `<img class="ai-bundle__image" src="${this.escapeHTML(image)}" alt="${this.escapeHTML(product.title)}" loading="lazy" width="700" height="700">` : '<span class="ai-bundle__image-placeholder">No image</span>'}
          </a>
          <div class="ai-bundle__card-info">
            <h3 class="ai-bundle__product-title"><a href="${this.escapeHTML(this.productUrl(product))}">${this.escapeHTML(product.title)}</a></h3>
            <p class="ai-bundle__price" data-card-price>${this.money(first?.price ?? product.price)}</p>
            ${showSelector ? `<label class="ai-bundle__variant-label">Variant
              <select class="select__select ai-bundle__variant" data-variant-select>${variantOptions}</select>
            </label>` : `<input type="hidden" data-variant-select value="${first?.id || ''}">`}
            <button class="button button--secondary ai-bundle__add-one" type="button" data-add-one ${first ? '' : 'disabled'}>
              <span>Add to Cart</span>
              <span class="ai-bundle__button-spinner" aria-hidden="true"></span>
            </button>
          </div>
        </article>`;
    }

    render(products, reason) {
      this.reason.textContent = reason;
      this.grid.innerHTML = products.map((product, index) => this.cardTemplate(product, index)).join('');
      this.status.hidden = true;
      this.skeleton.hidden = true;
      this.message.hidden = true;
      this.content.hidden = false;
    }

    showMessage(text) {
      this.status.hidden = true;
      this.skeleton.hidden = true;
      this.content.hidden = true;
      this.message.textContent = text;
      this.message.hidden = false;
    }

    handleVariantChange(event) {
      const select = event.target.closest('[data-variant-select]');
      if (!select) return;
      const card = select.closest('[data-product-card]');
      const price = select.selectedOptions?.[0]?.dataset.price;
      if (price) card.querySelector('[data-card-price]').textContent = this.money(price);
    }

    async handleGridClick(event) {
      const button = event.target.closest('[data-add-one]');
      if (!button) return;
      const card = button.closest('[data-product-card]');
      const variantId = Number(card.querySelector('[data-variant-select]')?.value);
      if (!variantId) return this.flashMessage('Please select an available variant.', true);

      this.setButtonLoading(button, true);
      try {
        await this.addItems([{ id: variantId, quantity: 1 }]);
        this.flashMessage('Product added to cart.');
        this.publishCartUpdate();
      } catch (error) {
        this.flashMessage('Could not add this product. Please try again.', true);
      } finally {
        this.setButtonLoading(button, false);
      }
    }

    selectedItems() {
      return [...this.grid.querySelectorAll('[data-product-card]')]
        .filter(card => card.querySelector('[data-product-select]')?.checked)
        .map(card => Number(card.querySelector('[data-variant-select]')?.value))
        .filter(Boolean)
        .map(id => ({ id, quantity: 1 }));
    }

    async addEntireBundle() {
      const bundleItems = this.selectedItems();
      const items = [{ id: this.mainVariantId, quantity: 1 }, ...bundleItems];
      if (!bundleItems.length) return this.flashMessage('Select at least one bundle product.', true);

      this.setButtonLoading(this.addAllButton, true);
      try {
        await this.addItems(items);
        this.flashMessage('Entire bundle added to cart.');
        this.publishCartUpdate();
      } catch (error) {
        console.error('AI Bundle cart error:', error);
        this.flashMessage('We could not add the bundle. Please check product availability and try again.', true);
      } finally {
        this.setButtonLoading(this.addAllButton, false);
      }
    }

    async addItems(items) {
      const response = await fetch(`${window.Shopify.routes.root}cart/add.js`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items })
      });
      if (!response.ok) throw new Error(`Shopify cart API failed with ${response.status}`);
      return response.json();
    }

    publishCartUpdate() {
      document.dispatchEvent(new CustomEvent('cart:refresh'));
      fetch(`${window.Shopify.routes.root}cart.js`)
        .then(response => response.json())
        .then(cart => document.dispatchEvent(new CustomEvent('cart:updated', { detail: { cart } })))
        .catch(() => {});
    }

    setButtonLoading(button, loading) {
      button.disabled = loading;
      button.classList.toggle('is-loading', loading);
    }

    flashMessage(text, isError = false) {
      this.message.textContent = text;
      this.message.classList.toggle('ai-bundle__message--error', isError);
      this.message.hidden = false;
      clearTimeout(this.messageTimer);
      this.messageTimer = setTimeout(() => { this.message.hidden = true; }, 4500);
    }
  }

  const mount = (scope = document) => {
    scope.querySelectorAll(SELECTOR).forEach(root => {
      if (root.dataset.initialized) return;
      root.dataset.initialized = 'true';
      new AIBundle(root);
    });
  };

  document.addEventListener('DOMContentLoaded', () => mount());
  document.addEventListener('shopify:section:load', event => mount(event.target));
})();
