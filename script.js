// konfigurasi terhadap API  untuk mengkoneksikan aplikasi dengan server
const API = {
  products: '/api/products',
  restock:  '/api/restock',
  checkout: '/api/checkout',
  orders:   '/api/orders',
};

// state logic
let products = [];               // hasil fetch dari database
const cart = new Map();          // product id -> { id, name, price, image, stock, qty }

const rupiah = value => 'Rp' + Number(value).toLocaleString('id-ID');
const paymentLabel = method => ({
  cash: 'Tunai', debit: 'Debit', credit_card: 'Kartu Kredit', qris: 'QRIS',
}[method] || method || '-');
const formatDateTime = value => new Date(value).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

//  elemen yang digunakan untuk manipulasi DOM pada website
const menuList       = document.querySelector('#menu-list');
const cartCount       = document.querySelector('#cart-count');
const cartTotal        = document.querySelector('#cart-total');
const orderSummary    = document.querySelector('#order-summary');
const paymentTotal    = document.querySelector('#payment-total');
const checkoutButton  = document.querySelector('#checkout-button');
const payButton       = document.querySelector('#pay-button');
const stockList        = document.querySelector('#stock-list');
const stockStatus     = document.querySelector('#stock-status');
const productForm     = document.querySelector('#product-form');
const loginForm       = document.querySelector('#login-form');
const loginError      = document.querySelector('#login-error');
const logoutButton    = document.querySelector('#logout-button');
const historyList     = document.querySelector('#history-list');
const historyDate     = document.querySelector('#history-date');
const historyFilterButton = document.querySelector('#history-filter-btn');
const historyResetButton  = document.querySelector('#history-reset-btn');
const openDashboardButton = document.querySelector('#open-dashboard');

// elemen struk pembayaran
const receiptOrderNumber = document.querySelector('#receipt-order-number');
const receiptDate        = document.querySelector('#receipt-date');
const receiptItems       = document.querySelector('#receipt-items');
const receiptTotal       = document.querySelector('#receipt-total');
const receiptPrintButton = document.querySelector('#receipt-print-btn');
const receiptCloseButton = document.querySelector('#receipt-close-btn');

//  sesi admin: fungsi-fungsi terkait autentikasi dan manajemen dashboard
async function checkSession() {
  try {
    const res = await fetch('/api/session');
    const data = await res.json();
    return data.user; // null kalau belum login
  } catch {
    return null;
  }
}

// ambil data menu dari database
async function loadProducts() {
  try {
    const res = await fetch(API.products);
    if (!res.ok) throw new Error('Gagal memuat menu dari server.');
    products = await res.json();
    const activeCategory = document.querySelector('.category-row button.active')?.dataset.category ?? 'makanan-utama';
    renderMenu(activeCategory);
    renderStockDashboard();
  } catch (err) {
    menuList.innerHTML = `<p class="error-state">${err.message} Cek apakah server database MySQL sudah aktif.</p>`;
  }
}

// render menu publik berdasarkan kategori
function renderMenu(category) {
  const items = products.filter(p => p.category === category);

  if (items.length === 0) {
    menuList.innerHTML = '<p class="empty-cart">Belum ada menu di kategori ini.</p>';
    return;
  }

  menuList.innerHTML = items.map(item => `
    <article class="card">
      <img src="${item.image || 'assets/placeholder.jpg'}" alt="${item.name}">
      <div class="card-body">
        <div class="menu-meta">
          <h3 class="name">${item.name}</h3>
          <div class="price">${rupiah(item.price)}</div>
        </div>
        <p class="menu-stock ${item.stock <= 0 ? 'out' : ''}">${item.stock > 0 ? `Stok: ${item.stock}` : 'Stok habis'}</p>
        ${item.stock > 0
          ? `<button class="add" data-id="${item.id}">+ Tambah ke keranjang</button>`
          : `<button class="add" disabled>Stok habis</button>`}
      </div>
    </article>`).join('');
}

document.querySelector('.category-row').addEventListener('click', event => {
  const button = event.target.closest('button');
  if (!button) return;
  document.querySelectorAll('.category-row button').forEach(el => el.classList.toggle('active', el === button));
  renderMenu(button.dataset.category);
});

menuList.addEventListener('click', event => {
  const button = event.target.closest('.add');
  if (!button || button.disabled) return;
  addToCart(Number(button.dataset.id));
  button.textContent = '✓ Ditambahkan';
  button.classList.add('added');
  setTimeout(() => { button.textContent = '+ Tambah ke keranjang'; button.classList.remove('added'); }, 900);
});

// fungsi-fungsi terkait keranjang belanja  dan otomatis memperbarui tampilan dengan menambahkan item
function addToCart(id) {
  const product = products.find(p => p.id === id);
  if (!product) return;

  const existing = cart.get(id);
  const currentQty = existing ? existing.qty : 0;

  if (currentQty + 1 > product.stock) {
    alert(`Stok ${product.name} cuma tersisa ${product.stock}.`);
    return;
  }

  if (existing) existing.qty += 1;
  else cart.set(id, { ...product, qty: 1 });

  syncCart();
}

function changeQty(id, delta) {
  const item = cart.get(id);
  if (!item) return;
  const product = products.find(p => p.id === id);

  if (delta > 0 && item.qty + 1 > product.stock) {
    alert(`Stok ${item.name} cuma tersisa ${product.stock}.`);
    return;
  }

  item.qty += delta;
  if (item.qty <= 0) cart.delete(id);
  syncCart();
  renderOrderSummary();
}

function cartTotals() {
  let total = 0, count = 0;
  cart.forEach(item => { total += item.price * item.qty; count += item.qty; });
  return { total, count };
}

function syncCart() {
  const { total, count } = cartTotals();
  cartCount.textContent = count;
  cartTotal.textContent = rupiah(total);
  paymentTotal.textContent = rupiah(total);
  checkoutButton.disabled = count === 0;
  payButton.disabled = count === 0;
}

// ringkasan pesanan (modal pembayaran)
function renderOrderSummary() {
  const { total, count } = cartTotals();

  if (count === 0) {
    orderSummary.innerHTML = '<p class="empty-cart">Keranjang kamu masih kosong.</p>';
    paymentTotal.textContent = rupiah(0);
    return;
  }

  const rows = [...cart.values()].map(item => `
    <div class="summary-row" data-id="${item.id}">
      <img src="${item.image || 'assets/placeholder.jpg'}" alt="${item.name}">
      <div class="summary-info">
        <p class="summary-name">${item.name}</p>
        <p class="summary-price">${rupiah(item.price)}</p>
      </div>
      <div class="qty-stepper">
        <button type="button" class="qty-minus" aria-label="Kurangi">−</button>
        <span>${item.qty}</span>
        <button type="button" class="qty-plus" aria-label="Tambah">+</button>
      </div>
      <div class="summary-subtotal">${rupiah(item.price * item.qty)}</div>
    </div>`).join('');

  orderSummary.innerHTML = `
    <div class="summary-list">${rows}</div>
    <div class="summary-total-row"><span>Total</span><strong>${rupiah(total)}</strong></div>`;

  paymentTotal.textContent = rupiah(total);
}

orderSummary.addEventListener('click', event => {
  const row = event.target.closest('.summary-row');
  if (!row) return;
  const id = Number(row.dataset.id);
  if (event.target.closest('.qty-plus')) changeQty(id, +1);
  if (event.target.closest('.qty-minus')) changeQty(id, -1);
});

// modal: fungsi-fungsi untuk membuka dan menutup modal pada pembayaran dan dashboard
function openModal(id) {
  const modal = document.getElementById(id);
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

document.querySelector('#open-payment').addEventListener('click', () => { renderOrderSummary(); openModal('payment-modal'); });
checkoutButton.addEventListener('click', () => { renderOrderSummary(); openModal('payment-modal'); });

function setDashboardButtonLabel(isLoggedIn) {
  openDashboardButton.textContent = isLoggedIn ? 'Dashboard' : 'Login';
}

document.querySelector('#open-dashboard').addEventListener('click', async () => {
  const user = await checkSession();
  setDashboardButtonLabel(Boolean(user));
  if (user) {
    document.querySelector('#admin-greeting').textContent = `Halo, admin ${user.name}`;
    renderStockDashboard();
    openModal('dashboard-modal');
  } else {
    loginError.hidden = true;
    loginForm.reset();
    openModal('login-modal');
  }
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  const submitButton = loginForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  loginError.hidden = true;

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: formData.get('username'),
        password: formData.get('password'),
      }),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Login gagal.');

    closeModal('login-modal');
    document.querySelector('#admin-greeting').textContent = `Halo, admin ${result.user.name}`;
    setDashboardButtonLabel(true);
    renderStockDashboard();
    openModal('dashboard-modal');
  } catch (err) {
    loginError.textContent = err.message;
    loginError.hidden = false;
  } finally {
    submitButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  setDashboardButtonLabel(false);
  closeModal('dashboard-modal');
});

document.querySelectorAll('.close-modal').forEach(btn => btn.addEventListener('click', () => closeModal(btn.dataset.close)));
document.querySelectorAll('.modal').forEach(modal => modal.addEventListener('click', e => { if (e.target === modal) closeModal(modal.id); }));
document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.modal.open').forEach(m => closeModal(m.id)); });

// metode pembayaran
document.querySelectorAll('.payment-methods label').forEach(label => {
  label.addEventListener('click', () => {
    document.querySelectorAll('.payment-methods label').forEach(l => l.classList.remove('selected'));
    label.classList.add('selected');
  });
});
document.querySelector('.payment-methods input:checked')?.closest('label')?.classList.add('selected');

//  struk pembayaran: render isi struk.
//  itemList & total diambil dari snapshot keranjang di browser (bukan dari respons server saja),
//  supaya daftar barang tetap muncul walau server.js belum mengirim field "items".
function renderReceipt({ orderNumber, paidAt, itemList, total }) {
  receiptOrderNumber.textContent = orderNumber;
  receiptDate.textContent = formatDateTime(paidAt || Date.now());
  receiptTotal.textContent = rupiah(total);

  receiptItems.innerHTML = itemList.map(item => `
    <div class="receipt-item-row">
      <div>
        <div class="receipt-item-name">${item.name}</div>
        <div class="receipt-item-qty">${item.qty} × ${rupiah(item.price)}</div>
      </div>
      <div class="receipt-item-subtotal">${rupiah(item.price * item.qty)}</div>
    </div>`).join('');
}

receiptPrintButton.addEventListener('click', () => window.print());
receiptCloseButton.addEventListener('click', () => closeModal('receipt-modal'));

// proses bayar yang langsung ke kasir (tunai)
payButton.addEventListener('click', async () => {
  const { count, total } = cartTotals();
  if (count === 0) return;

  const method = document.querySelector('.payment-methods input:checked')?.value ?? 'cash';

  // Konfirmasi ulang khusus buat pembayaran tunai, karena nggak ada verifikasi otomatis kayak QRIS/kartu
  if (method === 'cash') {
    const confirmed = confirm(`Konfirmasi: pelanggan bayar tunai sebesar ${rupiah(total)}?`);
    if (!confirmed) return;
  }

  const items = [...cart.values()].map(item => ({ product_id: item.id, quantity: item.qty }));

  payButton.disabled = true;
  payButton.classList.add('processing');
  payButton.innerHTML = '<span class="spinner"></span> Memproses pembayaran…';

  try {
    const res = await fetch(API.checkout, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, payment_method: method }),
    });
    const result = await res.json();

    if (!res.ok || result.error) throw new Error(result.error || 'Pembayaran gagal.');

    // Snapshot keranjang SEBELUM dikosongkan, supaya struk pasti punya daftar barangnya
    const itemList = [...cart.values()].map(item => ({ name: item.name, price: item.price, qty: item.qty }));
    const receiptData = {
      orderNumber: result.order_number,
      paidAt: result.paid_at,
      itemList,
      total: result.total_amount ?? total,
    };

    payButton.classList.remove('processing');
    payButton.classList.add('success');
    payButton.innerHTML = '✓ Pembayaran berhasil';

    // Siapkan struk sebelum keranjang dikosongkan, lalu tampilkan begitu modal pembayaran ditutup
    setTimeout(async () => {
      cart.clear();
      syncCart();
      closeModal('payment-modal');
      payButton.classList.remove('success');
      payButton.innerHTML = `Bayar sekarang <span id="payment-total">${rupiah(0)}</span>`;

      renderReceipt(receiptData);
      openModal('receipt-modal');

      await loadProducts(); // refresh stok terbaru dari database
    }, 900);
  } catch (err) {
    payButton.classList.remove('processing');
    payButton.disabled = false;
    payButton.innerHTML = `Bayar sekarang <span id="payment-total">${paymentTotal.textContent}</span>`;
    alert(err.message);
  }
});

/*dashboard: daftar stok*/
function renderStockDashboard() {
  if (products.length === 0) {
    stockList.innerHTML = '<p class="empty-cart">Belum ada data menu.</p>';
    return;
  }

  const lowStock = products.filter(p => p.stock <= p.minimum_stock);
  stockStatus.textContent = lowStock.length === 0 ? 'Stok aman' : `${lowStock.length} menu stoknya kritis`;
  stockStatus.classList.toggle('critical', lowStock.length > 0);

  stockList.innerHTML = products.map(item => `
    <div class="stock-row ${item.stock <= item.minimum_stock ? 'low' : ''}" data-id="${item.id}">
      <img src="${item.image || 'assets/placeholder.jpg'}" alt="${item.name}">
      <div class="stock-info">
        <p class="stock-name">${item.name}</p>
        <p class="stock-meta">${item.sku} · sisa <strong>${item.stock}</strong></p>
      </div>
      <div class="restock-control">
        <input type="number" min="1" placeholder="Jml" class="restock-qty">
        <button type="button" class="restock-btn">+ Stok</button>
      </div>
    </div>`).join('');
}

stockList.addEventListener('click', async event => {
  const button = event.target.closest('.restock-btn');
  if (!button) return;

  const row = button.closest('.stock-row');
  const id = Number(row.dataset.id);
  const input = row.querySelector('.restock-qty');
  const quantity = Number(input.value);

  if (!quantity || quantity <= 0) {
    alert('Masukkan jumlah stok yang valid.');
    return;
  }

  button.disabled = true;
  button.textContent = '...';

  try {
    const res = await fetch(API.restock, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product_id: id, quantity }),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Gagal menambah stok.');

    await loadProducts();
    renderStockDashboard();
  } catch (err) {
    alert(err.message);
    button.disabled = false;
    button.textContent = '+ Stok';
  }
});

// dashboard: tambah menu baru
productForm.addEventListener('submit', async event => {
  event.preventDefault();

  const formData = new FormData(productForm);
  const payload = {
    name: formData.get('name'),
    price: formData.get('price'),
    stock: formData.get('stock'),
    category: formData.get('category'),
    image: formData.get('image'),
  };

  const submitButton = productForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Menyimpan…';

  try {
    const res = await fetch(API.products, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await res.json();
    if (!res.ok || result.error) throw new Error(result.error || 'Gagal menyimpan menu.');

    productForm.reset();
    await loadProducts();
    renderStockDashboard();
    alert('Menu baru berhasil ditambahkan.');
  } catch (err) {
    alert(err.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Simpan menu';
  }
});

/* dashboard: tab switching antara "Stok & Menu" dan "Riwayat Pembelian" */
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.dashboard-content[data-panel]').forEach(panel => {
      panel.hidden = panel.dataset.panel !== btn.dataset.tab;
    });
    if (btn.dataset.tab === 'riwayat') loadHistory(historyDate.value || null);
  });
});

/* dashboard: riwayat pembelian */
async function loadHistory(date) {
  historyList.innerHTML = '<p class="empty-cart">Memuat riwayat…</p>';

  try {
    const url = date ? `${API.orders}?date=${date}` : API.orders;
    const res = await fetch(url);

    if (res.status === 401) {
      historyList.innerHTML = '<p class="error-state">Sesi admin habis, silakan login ulang.</p>';
      return;
    }
    if (!res.ok) throw new Error('Gagal memuat riwayat pembelian.');

    const orders = await res.json();
    renderHistory(orders);
  } catch (err) {
    historyList.innerHTML = `<p class="error-state">${err.message}</p>`;
  }
}

function renderHistory(orders) {
  if (orders.length === 0) {
    historyList.innerHTML = '<p class="empty-cart">Belum ada transaksi untuk ditampilkan.</p>';
    return;
  }

  historyList.innerHTML = orders.map(order => `
    <div class="history-row">
      <div class="history-main">
        <p class="history-order-number">${order.order_number}</p>
        <p class="history-date">${formatDateTime(order.created_at)}</p>
        <p class="history-items">${order.items_summary || '-'}</p>
      </div>
      <div class="history-side">
        <span class="history-method">${paymentLabel(order.payment_method)}</span>
        <strong class="history-total">${rupiah(order.total_amount)}</strong>
      </div>
    </div>`).join('');
}

historyFilterButton.addEventListener('click', () => loadHistory(historyDate.value || null));
historyResetButton.addEventListener('click', () => { historyDate.value = ''; loadHistory(); });

// inisialisasi website/admin/dashboard
syncCart();
loadProducts();
checkSession().then(user => setDashboardButtonLabel(Boolean(user)));