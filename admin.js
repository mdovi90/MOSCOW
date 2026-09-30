const isLoginPage = window.location.pathname.endsWith('admin-login.html');

const setMessage = (selector, text, type = '') => {
  const el = document.querySelector(selector);
  if (!el) return;
  el.textContent = text;
  el.className = `login-message ${type}`.trim();
};

const renderUserBadge = (user) => {
  const element = document.getElementById('header-user');
  if (!element) return;
  element.textContent = user ? `${user.username || user.email}` : 'Not signed in';
};

async function handleLogin(event) {
  event.preventDefault();
  const form = event.target;
  const payload = {
    usernameOrEmail: form.usernameOrEmail.value.trim(),
    password: form.password.value,
  };

  setMessage('#login-message', 'Logging in...', '');

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const result = await response.json();
    if (!response.ok || !result.ok) {
      setMessage('#login-message', result.error || 'Login failed.', 'error');
      return;
    }

    window.location.href = '/admin';
  } catch (error) {
    setMessage('#login-message', 'Unable to reach the server.', 'error');
  }
}

async function requireAuth() {
  try {
    const response = await fetch('/api/admin/session');
    if (!response.ok) {
      window.location.href = '/admin-login.html';
      return null;
    }

    const result = await response.json();
    renderUserBadge(result.user);
    return result.user;
  } catch (error) {
    window.location.href = '/admin-login.html';
    return null;
  }
}

async function logout() {
  await fetch('/api/admin/logout', { method: 'POST' });
  window.location.href = '/admin-login.html';
}

function formatBDT(value) {
  return `৳ ${Number(value || 0).toLocaleString('en-BD')}`;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const parsed = await response.json();
  if (!response.ok) throw new Error(parsed.error || 'Request failed.');
  return parsed;
}

async function loadDashboard() {
  const response = await fetchJson('/api/admin/dashboard');
  const { dashboard } = response;

  const cards = [
    { label: 'Total Product', value: dashboard.totalProducts },
    { label: 'Available Product', value: dashboard.availableProducts },
    { label: 'Out of Stock Product', value: dashboard.outOfStockProducts },
    { label: 'Total Order', value: dashboard.totalOrders },
    { label: 'Pending Order', value: dashboard.pendingOrders },
    { label: 'Confirmed Order', value: dashboard.confirmedOrders },
    { label: 'Delivered Order', value: dashboard.deliveredOrders },
    { label: 'Today\'s Orders', value: dashboard.todaysOrders },
    { label: 'Today\'s Sales', value: formatBDT(dashboard.todaysSales) },
  ];

  const html = `
    <div class="metrics-grid">
      ${cards.map((item) => `
        <div class="metric-card">
          <span class="label">${item.label}</span>
          <span class="value">${item.value}</span>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('admin-content').innerHTML = html;
}

async function renderProducts() {
  const response = await fetchJson('/api/admin/products');
  const products = response.products || [];

  const formHtml = `
    <form id="product-form" class="panel-form" enctype="multipart/form-data">
      <h3>Add / Update Product</h3>
      <div class="form-grid two">
        <label>Product Name<input name="name" required placeholder="Chicken Burger" /></label>
        <label>Category<select name="category">
          <option>Fast Food</option>
          <option>Burger</option>
          <option>Shawarma</option>
          <option>Pizza</option>
          <option>Sweets</option>
          <option>Bakery</option>
          <option>Coffee</option>
          <option>Lassi</option>
          <option>Cake</option>
          <option>Dessert</option>
        </select></label>
        <label>Price<input name="price" type="number" required min="0" step="1" /></label>
        <label>Discount Price<input name="discount_price" type="number" min="0" step="1" /></label>
        <label>Image / Video<input name="image" type="file" accept="image/*,video/*" /></label>
        <label>Display Order<input name="display_order" type="number" min="0" /></label>
        <label>Available<select name="available"><option value="true">Available</option><option value="false">Unavailable</option></select></label>
        <label>Featured<select name="featured"><option value="true">Featured</option><option value="false">Not Featured</option></select></label>
        <label>Stock Status<select name="stock_status"><option value="in_stock">In Stock</option><option value="out_of_stock">Out of Stock</option></select></label>
        <label>Hidden<select name="is_hidden"><option value="false">Visible</option><option value="true">Hidden</option></select></label>
      </div>
      <label>Short Description<textarea name="short_description" placeholder="Short description"></textarea></label>
      <label>Full Description<textarea name="full_description" placeholder="Full description"></textarea></label>
      <button type="submit" class="primary-btn full">Save Product</button>
      <p id="product-message" class="form-message"></p>
    </form>
  `;

  const listHtml = `
    <div class="table-wrap">
      <h3>Products</h3>
      <table>
        <thead>
          <tr><th>Product</th><th>Price</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          ${products.map((product) => `
            <tr>
              <td>
                <div class="product-info">
                  ${/\.(mp4|webm|mov)(?:[?#].*)?$/i.test(product.image_url || '')
                    ? `<video src="${product.image_url}" aria-label="${product.name}" controls muted playsinline style="width:64px;height:64px;object-fit:cover;border-radius:12px;"></video>`
                    : `<img src="${product.image_url || '/uploads/default-product.png'}" alt="${product.name}" style="width:64px;height:64px;object-fit:cover;border-radius:12px;" />`}
                  <strong>${product.name}</strong>
                  <span class="muted">${product.category}</span>
                </div>
              </td>
              <td>${formatBDT(product.price)}</td>
              <td>${product.available ? 'Available' : 'Unavailable'} / ${product.stock_status || 'in_stock'}</td>
              <td>
                <div class="product-actions">
                  <button class="ghost-btn" data-edit-id="${product.id}">Edit</button>
                  <button class="secondary-btn" data-toggle-id="${product.id}">${product.is_hidden ? 'Show' : 'Hide'}</button>
                  <button class="danger-btn" data-delete-id="${product.id}">Delete</button>
                </div>
              </td>
            </tr>
          `).join('') || '<tr><td colspan="4">No products yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('admin-content').innerHTML = `
    <div class="two-col">
      ${formHtml}
      ${listHtml}
    </div>
  `;

  const form = document.getElementById('product-form');
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const imageFile = formData.get('image');

    try {
      const response = await fetch('/api/admin/products', {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || 'Product save failed.');
      form.reset();
      document.getElementById('product-message').className = 'form-message success';
      document.getElementById('product-message').textContent = 'Product saved successfully.';
      renderProducts();
    } catch (error) {
      document.getElementById('product-message').className = 'form-message error';
      document.getElementById('product-message').textContent = error.message;
    }
  });

  document.querySelectorAll('[data-delete-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/admin/products/${button.dataset.deleteId}`, { method: 'DELETE' });
      renderProducts();
    });
  });

  document.querySelectorAll('[data-toggle-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/admin/products/${button.dataset.toggleId}/toggle`, {
        method: 'PATCH',
        body: JSON.stringify({ field: 'is_hidden' }),
      });
      renderProducts();
    });
  });

  document.querySelectorAll('[data-edit-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const productId = button.dataset.editId;
      const product = products.find((item) => String(item.id) === String(productId));
      if (!product) return;
      const form = document.getElementById('product-form');
      form.name.value = product.name;
      form.category.value = product.category;
      form.price.value = product.price;
      form.discount_price.value = product.discount_price || 0;
      form.available.value = String(Boolean(product.available));
      form.featured.value = String(Boolean(product.featured));
      form.stock_status.value = product.stock_status || 'in_stock';
      form.is_hidden.value = String(Boolean(product.is_hidden));
      form.display_order.value = product.display_order || 0;
      form.short_description.value = product.short_description || '';
      form.full_description.value = product.full_description || '';
      form.dataset.editId = String(product.id);
      form.querySelector('button[type="submit"]').textContent = 'Update Product';
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });

      form.onsubmit = async (event) => {
        event.preventDefault();
        try {
          const updateForm = new FormData(form);
          const response = await fetch(`/api/admin/products/${productId}`, {
            method: 'PUT',
            body: updateForm,
          });
          const result = await response.json();
          if (!response.ok || !result.ok) throw new Error(result.error || 'Update failed.');
          form.reset();
          form.querySelector('button[type="submit"]').textContent = 'Save Product';
          delete form.dataset.editId;
          renderProducts();
        } catch (error) {
          document.getElementById('product-message').className = 'form-message error';
          document.getElementById('product-message').textContent = error.message;
        }
      };
    });
  });
}

async function renderOrders() {
  const response = await fetchJson('/api/admin/orders');
  const orders = response.orders || [];

  const html = `
    <div class="panel-form">
      <h3>Orders</h3>
      <div class="order-list">
        ${orders.map((order) => `
          <div class="order-item">
            <div class="order-info">
              <strong>${order.id}</strong>
              <span>${order.customer_name} • ${order.phone}</span>
              <span class="muted">${order.address}</span>
              <span class="muted">${(order.order_items || []).map((item) => `${item.name} x ${item.qty}`).join(', ')}</span>
              <span class="muted">${formatBDT(order.total)} • ${order.payment_method}</span>
            </div>
            <div class="order-actions">
              <select class="status-select" data-order-id="${order.id}">
                ${['Pending', 'Confirmed', 'Preparing', 'Ready', 'Out for Delivery', 'Delivered', 'Cancelled'].map((status) => `
                  <option value="${status}" ${order.status === status ? 'selected' : ''}>${status}</option>
                `).join('')}
              </select>
            </div>
          </div>
        `).join('') || '<p class="muted">No orders yet.</p>'}
      </div>
    </div>
  `;

  document.getElementById('admin-content').innerHTML = html;

  document.querySelectorAll('[data-order-id]').forEach((select) => {
    select.addEventListener('change', async (event) => {
      const status = event.target.value;
      const orderId = event.target.dataset.orderId;
      await fetchJson(`/api/admin/orders/${orderId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      renderOrders();
    });
  });
}

async function renderCategories() {
  const response = await fetchJson('/api/admin/categories');
  const categories = response.categories || [];

  const formHtml = `
    <form id="category-form" class="panel-form">
      <h3>Add Category</h3>
      <label>Name<input name="name" required placeholder="Burger" /></label>
      <label>Image URL<input name="image_url" placeholder="https://..." /></label>
      <label>Sort Order<input name="sort_order" type="number" value="0" /></label>
      <button type="submit" class="primary-btn full">Save Category</button>
      <p id="category-message" class="form-message"></p>
    </form>
  `;

  const listHtml = `
    <div class="panel-form">
      <h3>Categories</h3>
      <div class="category-list">
        ${categories.map((category) => `
          <div class="category-item">
            <img src="${category.image_url}" alt="${category.name}" />
            <div class="category-info">
              <strong>${category.name}</strong>
              <span class="muted">${category.is_visible ? 'Visible' : 'Hidden'}</span>
            </div>
            <div class="item-actions">
              <button class="ghost-btn" data-category-edit="${category.id}">Edit</button>
              <button class="danger-btn" data-category-delete="${category.id}">Delete</button>
            </div>
          </div>
        `).join('') || '<p class="muted">No categories yet.</p>'}
      </div>
    </div>
  `;

  document.getElementById('admin-content').innerHTML = `
    <div class="two-col">
      ${formHtml}
      ${listHtml}
    </div>
  `;

  document.getElementById('category-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    try {
      const result = await fetchJson('/api/admin/categories', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      document.getElementById('category-message').className = 'form-message success';
      document.getElementById('category-message').textContent = 'Category added.';
      event.target.reset();
      renderCategories();
    } catch (error) {
      document.getElementById('category-message').className = 'form-message error';
      document.getElementById('category-message').textContent = error.message;
    }
  });

  document.querySelectorAll('[data-category-delete]').forEach((button) => {
    button.addEventListener('click', async () => {
      await fetchJson(`/api/admin/categories/${button.dataset.categoryDelete}`, { method: 'DELETE' });
      renderCategories();
    });
  });
}

async function renderOffers() {
  const response = await fetchJson('/api/admin/offers');
  const offers = response.offers || [];

  const formHtml = `
    <form id="offer-form" class="panel-form">
      <h3>Offers</h3>
      <label>Offer Title<input name="title" placeholder="আজকের বিশেষ অফার" /></label>
      <label>Image URL<input name="image_url" placeholder="https://..." /></label>
      <label>Description<textarea name="description" placeholder="২টি বার্গার + ২টি ফ্রাই + ২টি ড্রিংক"></textarea></label>
      <div class="form-grid two">
        <label>Old Price<input name="old_price" type="number" value="0" /></label>
        <label>Offer Price<input name="offer_price" type="number" value="0" /></label>
      </div>
      <button type="submit" class="primary-btn full">Save Offer</button>
      <p id="offer-message" class="form-message"></p>
    </form>
  `;

  const listHtml = `
    <div class="panel-form">
      <h3>Active Offers</h3>
      <div class="offer-list">
        ${offers.map((offer) => `
          <div class="offer-item">
            <img src="${offer.image_url || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?auto=format&fit=crop&w=900&q=80'}" alt="${offer.title}" />
            <div class="offer-info">
              <strong>${offer.title}</strong>
              <span class="muted">${offer.description}</span>
              <span class="muted">${formatBDT(offer.old_price)} → ${formatBDT(offer.offer_price)}</span>
            </div>
            <div class="item-actions">
              <button class="ghost-btn" data-offer-edit="${offer.id}">Edit</button>
            </div>
          </div>
        `).join('') || '<p class="muted">No offers.</p>'}
      </div>
    </div>
  `;

  document.getElementById('admin-content').innerHTML = `
    <div class="two-col">
      ${formHtml}
      ${listHtml}
    </div>
  `;

  document.getElementById('offer-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    try {
      await fetchJson('/api/admin/offers', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      document.getElementById('offer-message').className = 'form-message success';
      document.getElementById('offer-message').textContent = 'Offer created.';
      event.target.reset();
      renderOffers();
    } catch (error) {
      document.getElementById('offer-message').className = 'form-message error';
      document.getElementById('offer-message').textContent = error.message;
    }
  });
}

async function renderSettings() {
  const response = await fetchJson('/api/admin/settings');
  const settings = response.settings || {};

  document.getElementById('admin-content').innerHTML = `
    <form id="settings-form" class="panel-form">
      <h3>Website Settings</h3>
      <div class="form-grid two">
        <label>Business Name<input name="business_name" value="${settings.business_name || 'Moscow Bakers'}" /></label>
        <label>Phone<input name="phone" value="${settings.phone || '+8801894839321'}" /></label>
        <label>WhatsApp<input name="whatsapp" value="${settings.whatsapp || '+8801894839321'}" /></label>
        <label>Currency<input name="currency" value="${settings.currency || '৳'}" /></label>
        <label>Delivery Charge<input name="delivery_charge" type="number" value="${settings.delivery_charge || 80}" /></label>
        <label>Free Delivery Min<input name="free_delivery_min" type="number" value="${settings.free_delivery_min || 1000}" /></label>
      </div>
      <label>Address<textarea name="address">${settings.address || 'Sitakunda, Chattogram, Bangladesh'}</textarea></label>
      <label>Opening Hours<input name="opening_hours" value="${settings.opening_hours || '9:00 AM - 11:00 PM'}" /></label>
      <label>Facebook URL<input name="facebook" value="${settings.facebook || 'https://facebook.com'}" /></label>
      <label>Instagram URL<input name="instagram" value="${settings.instagram || 'https://instagram.com'}" /></label>
      <label>TikTok URL<input name="tiktok" value="${settings.tiktok || 'https://tiktok.com'}" /></label>
      <label>Google Maps URL<input name="google_maps" value="${settings.google_maps || 'https://maps.google.com/?q=Sitakunda,Chattogram'}" /></label>
      <label>Delivery Areas<input name="delivery_areas" value="${settings.delivery_areas || 'Sitakunda'}" /></label>
      <button type="submit" class="primary-btn full">Save Settings</button>
      <p id="settings-message" class="form-message"></p>
    </form>
  `;

  document.getElementById('settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = Object.fromEntries(new FormData(event.target).entries());
    try {
      await fetchJson('/api/admin/settings', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const message = document.getElementById('settings-message');
      message.className = 'form-message success';
      message.textContent = 'Settings saved successfully.';
    } catch (error) {
      const message = document.getElementById('settings-message');
      message.className = 'form-message error';
      message.textContent = error.message;
    }
  });
}

async function renderSection(section) {
  document.querySelectorAll('.nav-link').forEach((button) => {
    button.classList.toggle('active', button.dataset.section === section);
  });

  const pageTitles = {
    dashboard: 'Dashboard',
    products: 'Products',
    orders: 'Orders',
    categories: 'Categories',
    offers: 'Offers',
    settings: 'Settings',
  };

  const titleNode = document.getElementById('page-title');
  if (titleNode) titleNode.textContent = pageTitles[section] || 'Dashboard';

  if (section === 'dashboard') return loadDashboard();
  if (section === 'products') return renderProducts();
  if (section === 'orders') return renderOrders();
  if (section === 'categories') return renderCategories();
  if (section === 'offers') return renderOffers();
  if (section === 'settings') return renderSettings();
}

if (isLoginPage) {
  const form = document.getElementById('login-form');
  if (form) {
    form.addEventListener('submit', handleLogin);
  }
} else {
  requireAuth().then((user) => {
    if (!user) return;
    document.getElementById('logout-button').addEventListener('click', logout);
    document.querySelectorAll('.nav-link').forEach((button) => {
      button.addEventListener('click', () => renderSection(button.dataset.section));
    });
    renderSection('dashboard');
  });
}
