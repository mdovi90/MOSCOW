const formatBDT = (value) => `৳ ${Number(value || 0).toLocaleString('en-BD')}`;
const apiBase = String(window.MB_API_BASE || '').replace(/\/$/, '');
const apiUrl = (path) => `${apiBase}${path}`;

let categories = [];
let products = [];
let offerData = [];
let cart = JSON.parse(localStorage.getItem('mb-cart') || '[]');
let checkoutForm = { customerName: '', mobile: '', address: '', area: '', district: 'Chattogram', notes: '', deliveryOption: 'Home Delivery', paymentMethod: 'Cash on Delivery' };
let successMessage = null;
let selectedProduct = null;
let selectedQty = 1;
let searchTerm = '';
const productQtyMap = {};

const sanitizeImage = (value) => {
  if (!value || typeof value !== 'string') {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80';
  }

  const cleaned = value.trim();
  if (!cleaned || cleaned.startsWith('blob:') || cleaned.startsWith('data:') || /\/default-(product|logo)\.png(?:[?#].*)?$/i.test(cleaned)) {
    return 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80';
  }

  if (apiBase && cleaned.startsWith('/')) return `${apiBase}${cleaned}`;
  return cleaned;
};

const renderProductMedia = (url, alt, className = '') => {
  const safeUrl = sanitizeImage(url);
  if (/\.(mp4|webm|mov)(?:[?#].*)?$/i.test(safeUrl)) {
    return `<video class="${className}" src="${safeUrl}" aria-label="${alt}" controls muted playsinline preload="metadata"></video>`;
  }
  return `<img class="${className}" src="${safeUrl}" alt="${alt}" loading="lazy" />`;
};

const readStoreData = async () => {
  try {
    const response = await fetch(apiUrl('/api/public/data'));
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'Failed to load store data');
    }

    categories = (payload.categories || []).map((category) => ({
      id: String(category.id),
      label: category.name,
      emoji: '🍽️',
      image: sanitizeImage(category.image_url || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=80'),
      name: category.name,
    }));

    products = (payload.products || []).map((product) => ({
      ...product,
      id: String(product.id),
      image: sanitizeImage(product.image_url || product.image),
      description: product.short_description || product.full_description || 'Freshly prepared product',
      price: Number(product.price || 0),
      active: Number(product.is_hidden) !== 1 && Number(product.available ?? 1) !== 0,
      available: Number(product.available ?? 1) !== 0 && String(product.stock_status || '').toLowerCase() !== 'out_of_stock',
      is_hidden: Number(product.is_hidden) === 1,
      featured: Number(product.featured) === 1,
      category: product.category || 'Fast Food',
    }));

    offerData = (payload.offers || []).map((offer) => ({
      id: String(offer.id),
      title: offer.title,
      label: 'Special Offer',
      description: offer.description,
      accent: 'orange',
    }));

    renderAll();
  } catch (error) {
    console.error(error);
  }
};

const updateCartCount = () => {
  const total = cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const countNode = document.getElementById('cart-count');
  if (countNode) countNode.textContent = String(total);
};

const getCartSubtotal = () => cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
const getDeliveryCharge = () => (cart.length ? 80 : 0);
const getGrandTotal = () => getCartSubtotal() + getDeliveryCharge();

const openCart = () => {
  const overlay = document.getElementById('cart-overlay');
  if (overlay) overlay.classList.remove('hidden');
  renderCart();
};

const closeCart = () => {
  const overlay = document.getElementById('cart-overlay');
  if (overlay) overlay.classList.add('hidden');
};

const addToCart = (product, qty = 1) => {
  if (!product || product.is_hidden || !product.available) {
    return;
  }

  const safeQty = Math.max(1, Number(qty) || 1);
  const existing = cart.find((item) => String(item.id) === String(product.id));

  if (existing) {
    cart = cart.map((item) => String(item.id) === String(product.id) ? { ...item, quantity: Number(item.quantity || 0) + safeQty } : item);
  } else {
    cart = [...cart, { ...product, quantity: safeQty, image: sanitizeImage(product.image) }];
  }

  localStorage.setItem('mb-cart', JSON.stringify(cart));
  renderCart();
  updateCartCount();
  openCart();
};

const updateCartItem = (id, change) => {
  cart = cart
    .map((item) => String(item.id) === String(id) ? { ...item, quantity: Number(item.quantity || 0) + change } : item)
    .filter((item) => Number(item.quantity || 0) > 0);

  localStorage.setItem('mb-cart', JSON.stringify(cart));
  renderCart();
  updateCartCount();
};

const removeCartItem = (id) => {
  cart = cart.filter((item) => String(item.id) !== String(id));
  localStorage.setItem('mb-cart', JSON.stringify(cart));
  renderCart();
  updateCartCount();
};

const renderProductCard = (product) => {
  const qty = Number(productQtyMap[product.id] || 1);
  const outOfStock = !product.available;
  const stockBadge = outOfStock ? '<span class="stock-badge">স্টক শেষ</span>' : '';

  return `
    <article class="product-card ${outOfStock ? 'out-of-stock' : ''}" data-product-id="${product.id}">
      <button class="wishlist-btn" aria-label="Save item">♡</button>
      ${stockBadge}
      ${renderProductMedia(product.image, product.name)}
      <div class="product-body">
        <div class="card-topline"><span>${product.category}</span></div>
        <h3>${product.name}</h3>
        <p>${product.description}</p>
        <div class="card-meta">
          <strong>${formatBDT(product.price)}</strong>
          <div class="qty-box">
            <button data-action="minus" data-id="${product.id}" ${outOfStock ? 'disabled' : ''}>-</button>
            <span>${qty}</span>
            <button data-action="plus" data-id="${product.id}" ${outOfStock ? 'disabled' : ''}>+</button>
          </div>
        </div>
        <div class="card-actions">
          <button class="primary-btn small" data-action="add" data-id="${product.id}" ${outOfStock ? 'disabled' : ''}>${outOfStock ? 'স্টক শেষ' : 'Add to Cart'}</button>
          <button class="secondary-btn small" data-action="view" data-id="${product.id}">View</button>
        </div>
      </div>
    </article>
  `;
};

const renderCategories = () => {
  const grid = document.getElementById('category-grid');
  if (!grid) return;

  const categoryList = categories;

  grid.innerHTML = categoryList.map((category) => `
    <button class="category-card" data-category="${category.label}">
      <img src="${category.image}" alt="${category.label}" />
      <div class="category-overlay">
        <span>${category.emoji}</span>
        <strong>${category.label}</strong>
      </div>
    </button>
  `).join('');

  grid.querySelectorAll('[data-category]').forEach((card) => {
    card.addEventListener('click', () => {
      searchTerm = card.dataset.category;
      const searchInput = document.getElementById('search-input');
      if (searchInput) searchInput.value = searchTerm;
      renderMenu();
      document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' });
    });
  });
};

const getFilteredProducts = () => {
  const term = searchTerm.trim().toLowerCase();
  const visible = products.filter((product) => product.active && !product.is_hidden);
  if (!term) return visible;
  return visible.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(term));
};

const bindProductActions = (root) => {
  if (!root) return;

  root.querySelectorAll('[data-action="minus"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      const nextValue = Math.max(1, (productQtyMap[id] || 1) - 1);
      productQtyMap[id] = nextValue;
      renderFeatured();
      renderMenu();
    });
  });

  root.querySelectorAll('[data-action="plus"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.id;
      productQtyMap[id] = (productQtyMap[id] || 1) + 1;
      renderFeatured();
      renderMenu();
    });
  });

  root.querySelectorAll('[data-action="add"]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = products.find((item) => String(item.id) === String(button.dataset.id));
      if (product) addToCart(product, productQtyMap[product.id] || 1);
    });
  });

  root.querySelectorAll('[data-action="view"]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = products.find((item) => String(item.id) === String(button.dataset.id));
      if (product) {
        selectedProduct = product;
        selectedQty = 1;
        renderProductModal();
      }
    });
  });
};

const renderFeatured = () => {
  const grid = document.getElementById('featured-grid');
  if (!grid) return;
  const featured = products.filter((product) => product.featured && product.active).slice(0, 8);
  grid.innerHTML = featured.map((product) => renderProductCard(product)).join('');
  bindProductActions(grid);
};

const renderMenu = () => {
  const menuGroups = document.getElementById('menu-groups');
  if (!menuGroups) return;

  const filtered = getFilteredProducts();
  const groups = categories.map((category) => category.name || category.label);

  menuGroups.innerHTML = groups.map((group) => {
    const items = filtered.filter((product) => product.category === group);
    if (!items.length) {
      return `
        <div class="menu-group" id="${group.toLowerCase().replace(/\s+/g, '-')}">
          <div class="group-header">
            <h3>${group}</h3>
            <span>0 items</span>
          </div>
          <div class="empty-category-message">এই ক্যাটাগরিতে এখনো কোনো পণ্য যোগ করা হয়নি</div>
        </div>
      `;
    }

    return `
      <div class="menu-group" id="${group.toLowerCase().replace(/\s+/g, '-')}">
        <div class="group-header">
          <h3>${group}</h3>
          <span>${items.length} items</span>
        </div>
        <div class="product-grid">
          ${items.map((product) => renderProductCard(product)).join('')}
        </div>
      </div>
    `;
  }).join('');

  bindProductActions(menuGroups);
};

const renderOffers = () => {
  const grid = document.getElementById('offers-grid');
  if (!grid) return;
  grid.innerHTML = (offerData || []).map((offer) => `
    <div class="offer-card accent-orange">
      <span>Special Offer</span>
      <h3>${offer.title}</h3>
      <p>${offer.description}</p>
    </div>
  `).join('');
};

const renderCombos = () => {
  const grid = document.getElementById('combo-grid');
  if (!grid) return;

  const combos = [
    { id: 'combo-1', title: 'Burger Meal', price: 420, items: 'Chicken Burger + Fries + Cold Drink', image: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80' },
    { id: 'combo-2', title: 'Pizza Combo', price: 680, items: 'Chicken Pizza + 1 Soft Drink', image: 'https://images.unsplash.com/photo-1513104890138-7c749659a591?auto=format&fit=crop&w=900&q=80' },
    { id: 'combo-3', title: 'Shawarma Combo', price: 450, items: 'Shawarma + Fries + Drink', image: 'https://images.unsplash.com/photo-1529006557810-274b9b2fc783?auto=format&fit=crop&w=900&q=80' },
    { id: 'combo-4', title: 'Coffee & Pastry', price: 360, items: 'Coffee + Pastry + Dessert', image: 'https://images.unsplash.com/photo-1497636577773-f1231844b336?auto=format&fit=crop&w=900&q=80' },
  ];

  grid.innerHTML = combos.map((combo) => `
    <article class="combo-card">
      <img src="${combo.image}" alt="${combo.title}" />
      <div>
        <span>Combo Deal</span>
        <h3>${combo.title}</h3>
        <p>${combo.items}</p>
        <strong>${formatBDT(combo.price)}</strong>
        <button class="primary-btn small" data-combo-id="${combo.id}">Order Combo</button>
      </div>
    </article>
  `).join('');

  grid.querySelectorAll('[data-combo-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const combo = combos.find((item) => item.id === button.dataset.comboId);
      if (combo) {
        addToCart({ id: combo.id, name: combo.title, category: 'Combo', price: combo.price, image: combo.image, description: combo.items }, 1);
      }
    });
  });
};

const renderCart = () => {
  const cartContent = document.getElementById('cart-content');
  if (!cartContent) return;

  if (!cart.length) {
    cartContent.innerHTML = `
      <div class="empty-cart">
        <p>Your cart is empty.</p>
        <button class="primary-btn small" id="continue-shopping">Continue Shopping</button>
      </div>
    `;
    document.getElementById('continue-shopping')?.addEventListener('click', closeCart);
    updateCartCount();
    return;
  }

  cartContent.innerHTML = `
    <div class="cart-items">
      ${cart.map((item) => `
        <div class="cart-item">
          ${renderProductMedia(item.image, item.name)}
          <div class="cart-item-copy">
            <strong>${item.name}</strong>
            <span>${formatBDT(item.price)}</span>
            <div class="qty-row">
              <button data-cart-minus="${item.id}">-</button>
              <span>${item.quantity}</span>
              <button data-cart-plus="${item.id}">+</button>
            </div>
          </div>
          <button class="remove-item" data-remove-id="${item.id}">Remove</button>
        </div>
      `).join('')}
    </div>

    <div class="cart-summary">
      <div><span>Subtotal</span><strong>${formatBDT(getCartSubtotal())}</strong></div>
      <div><span>Delivery</span><strong>${formatBDT(getDeliveryCharge())}</strong></div>
      <div class="grand-total"><span>Total</span><strong>${formatBDT(getGrandTotal())}</strong></div>
    </div>

    <form id="checkout-form" class="checkout-form">
      <h4>Checkout</h4>
      <input name="customerName" placeholder="Customer Name" required value="${checkoutForm.customerName}" />
      <input name="mobile" placeholder="Mobile Number" required value="${checkoutForm.mobile}" />
      <input name="address" placeholder="Delivery Address" required value="${checkoutForm.address}" />
      <div class="input-grid">
        <input name="area" placeholder="Area/Thana" required value="${checkoutForm.area}" />
        <input name="district" placeholder="District" required value="${checkoutForm.district}" />
      </div>
      <textarea name="notes" placeholder="Order Notes">${checkoutForm.notes}</textarea>
      <select name="deliveryOption">
        <option value="Home Delivery" ${checkoutForm.deliveryOption === 'Home Delivery' ? 'selected' : ''}>Home Delivery</option>
        <option value="Pickup" ${checkoutForm.deliveryOption === 'Pickup' ? 'selected' : ''}>Pickup</option>
      </select>
      <select name="paymentMethod">
        <option value="Cash on Delivery" ${checkoutForm.paymentMethod === 'Cash on Delivery' ? 'selected' : ''}>Cash on Delivery</option>
        <option value="bKash" ${checkoutForm.paymentMethod === 'bKash' ? 'selected' : ''}>bKash</option>
        <option value="Nagad" ${checkoutForm.paymentMethod === 'Nagad' ? 'selected' : ''}>Nagad</option>
        <option value="Card" ${checkoutForm.paymentMethod === 'Card' ? 'selected' : ''}>Card</option>
      </select>
      <button type="submit" class="primary-btn full">Place Order</button>
    </form>
  `;

  cartContent.querySelectorAll('[data-cart-minus]').forEach((button) => {
    button.addEventListener('click', () => updateCartItem(button.dataset.cartMinus, -1));
  });

  cartContent.querySelectorAll('[data-cart-plus]').forEach((button) => {
    button.addEventListener('click', () => updateCartItem(button.dataset.cartPlus, 1));
  });

  cartContent.querySelectorAll('[data-remove-id]').forEach((button) => {
    button.addEventListener('click', () => removeCartItem(button.dataset.removeId));
  });

  cartContent.querySelector('#checkout-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(event.target);
    checkoutForm = {
      customerName: String(formData.get('customerName') || ''),
      mobile: String(formData.get('mobile') || ''),
      address: String(formData.get('address') || ''),
      area: String(formData.get('area') || ''),
      district: String(formData.get('district') || 'Chattogram'),
      notes: String(formData.get('notes') || ''),
      deliveryOption: String(formData.get('deliveryOption') || 'Home Delivery'),
      paymentMethod: String(formData.get('paymentMethod') || 'Cash on Delivery'),
    };
    await placeOrder();
  });

  updateCartCount();
};

const renderProductModal = () => {
  const modal = document.getElementById('product-modal');
  if (!modal) return;

  if (!selectedProduct) {
    modal.classList.add('hidden');
    return;
  }

  const related = products.filter((item) => item.category === selectedProduct.category && item.id !== selectedProduct.id).slice(0, 3);
  modal.innerHTML = `
    <div class="product-modal">
      <button class="close-btn" id="close-modal">×</button>
      <div class="modal-grid">
        ${renderProductMedia(selectedProduct.image, selectedProduct.name)}
        <div class="modal-copy">
          <span>${selectedProduct.category}</span>
          <h3>${selectedProduct.name}</h3>
          <p>${selectedProduct.description}</p>
          <div class="modal-price-row">
            <strong>${formatBDT(selectedProduct.price)}</strong>
            <div class="qty-box">
              <button data-action="detail-minus">-</button>
              <span>${selectedQty}</span>
              <button data-action="detail-plus">+</button>
            </div>
          </div>
          <div class="modal-actions">
            <button class="primary-btn" data-action="modal-add" ${selectedProduct.available ? '' : 'disabled'}>${selectedProduct.available ? 'Add to Cart' : 'স্টক শেষ'}</button>
            <button class="secondary-btn" data-action="modal-buy" ${selectedProduct.available ? '' : 'disabled'}>Buy Now</button>
          </div>
          <div class="related-box">
            <h4>Related Items</h4>
            <div class="related-list">
              ${related.map((item) => `<button data-related-id="${item.id}">${item.name}</button>`).join('') || '<span>More items coming soon.</span>'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.querySelector('#close-modal')?.addEventListener('click', () => modal.classList.add('hidden'));
  modal.querySelector('[data-action="detail-minus"]')?.addEventListener('click', () => { selectedQty = Math.max(1, selectedQty - 1); renderProductModal(); });
  modal.querySelector('[data-action="detail-plus"]')?.addEventListener('click', () => { selectedQty += 1; renderProductModal(); });
  modal.querySelector('[data-action="modal-add"]')?.addEventListener('click', () => {
    if (!selectedProduct.available) return;
    addToCart(selectedProduct, selectedQty);
    modal.classList.add('hidden');
  });
  modal.querySelector('[data-action="modal-buy"]')?.addEventListener('click', () => {
    if (!selectedProduct.available) return;
    addToCart(selectedProduct, selectedQty);
    modal.classList.add('hidden');
    openCart();
  });
  modal.querySelectorAll('[data-related-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = products.find((item) => String(item.id) === String(button.dataset.relatedId));
      if (product) { selectedProduct = product; selectedQty = 1; renderProductModal(); }
    });
  });
};

const renderSuccessBanner = () => {
  const banner = document.getElementById('success-banner');
  if (!banner) return;
  if (!successMessage) {
    banner.classList.add('hidden');
    return;
  }

  banner.innerHTML = `
    <div class="container success-wrap">
      <div>
        <p>Order Placed Successfully!</p>
        <h3>Order ID: ${successMessage.id}</h3>
      </div>
      <div class="success-meta">
        <span><strong>${successMessage.customerName}</strong></span>
        <span>${successMessage.mobile}</span>
        <span>${successMessage.items.map((item) => `${item.name} x ${item.qty}`).join(', ')}</span>
        <span>${formatBDT(successMessage.total)}</span>
      </div>
      <a href="tel:+8801894839321" class="primary-btn small">Call to Order</a>
    </div>
  `;
  banner.classList.remove('hidden');
};

const placeOrder = async () => {
  const payload = {
    customerName: checkoutForm.customerName,
    phone: checkoutForm.mobile,
    mobile: checkoutForm.mobile,
    address: checkoutForm.address,
    subtotal: getCartSubtotal(),
    deliveryCharge: getDeliveryCharge(),
    total: getGrandTotal(),
    paymentMethod: checkoutForm.paymentMethod,
    items: cart.map((item) => ({ id: item.id, name: item.name, qty: Number(item.quantity || 1), price: Number(item.price || 0) })),
  };

  try {
    const response = await fetch(apiUrl('/api/public/orders'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || 'Unable to place order');
    }

    successMessage = { id: result.orderId, customerName: payload.customerName, mobile: payload.phone, total: payload.total, items: payload.items };
    cart = [];
    localStorage.setItem('mb-cart', JSON.stringify(cart));
    checkoutForm = { customerName: '', mobile: '', address: '', area: '', district: 'Chattogram', notes: '', deliveryOption: 'Home Delivery', paymentMethod: 'Cash on Delivery' };
    closeCart();
    renderSuccessBanner();
    renderAll();
  } catch (error) {
    alert(error.message);
  }
};

const renderAll = () => {
  renderCategories();
  renderFeatured();
  renderMenu();
  renderOffers();
  renderCombos();
  renderCart();
  updateCartCount();
  renderSuccessBanner();
};

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('brand-home')?.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
  document.getElementById('order-now')?.addEventListener('click', () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('explore-menu')?.addEventListener('click', () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('featured-menu-link')?.addEventListener('click', () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('combo-link')?.addEventListener('click', () => document.getElementById('menu')?.scrollIntoView({ behavior: 'smooth' }));
  document.getElementById('cart-button')?.addEventListener('click', openCart);
  document.getElementById('close-cart')?.addEventListener('click', closeCart);
  document.getElementById('cart-overlay')?.addEventListener('click', (event) => {
    if (event.target.id === 'cart-overlay') closeCart();
  });
  document.getElementById('search-button')?.addEventListener('click', () => document.getElementById('search-input')?.focus());
  document.getElementById('search-input')?.addEventListener('input', (event) => {
    searchTerm = event.target.value;
    renderMenu();
  });
  document.getElementById('hamburger-button')?.addEventListener('click', () => {
    document.getElementById('nav-menu')?.classList.toggle('nav-open');
  });

  readStoreData();
  setInterval(readStoreData, 5000);
});
