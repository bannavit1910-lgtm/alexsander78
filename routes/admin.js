const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAdmin } = require('../middleware/auth');
const upload = require('../middleware/upload');
const { cloudinary, uploadBanner, uploadHero } = require('../middleware/upload');

// นำเข้า Models
const User = require('../models/User');
const Product = require('../models/Product');
const Order = require('../models/Order');
const StockItem = require('../models/StockItem');
const Topup = require('../models/Topup');
const AdminLog = require('../models/AdminLog');
const CategoryBanner = require('../models/CategoryBanner');
const SiteContent = require('../models/SiteContent');

const router = express.Router();
router.use(requireAdmin);

// จำนวนไอดีสูงสุดที่ยอมให้เติมสต็อกต่อสินค้า 1 รายการ (นับเฉพาะที่ยังพร้อมขาย)
const MAX_STOCK_PER_PRODUCT = 500;

// ค่าเริ่มต้นของข้อความ hero หน้าแรก (ใช้ pre-fill ฟอร์มตอนยังไม่เคยตั้งค่าเอง)
const DEFAULT_HERO_HEADING = 'ไอดีเกมและสกินคุณภาพ\nระดับ **เทพ** ในที่เดียว';

async function logActivity(adminId, action, detail) {
  await AdminLog.create({ admin_id: adminId, action, detail });
}

// ---------- Dashboard ----------
router.get('/', async (req, res) => {
  const productCount = await Product.countDocuments();
  const memberCount = await User.countDocuments({ role: 'member' });
  const pendingTopups = await Topup.countDocuments({ status: 'pending' });
  
  // ยอดขายวันนี้ (MongoDB Date aggregation)
  const today = new Date();
  today.setHours(0,0,0,0);
  const salesTodayRes = await Order.aggregate([
    { $match: { createdAt: { $gte: today }, status: 'completed' } },
    { $group: { _id: null, total: { $sum: '$price_paid' } } }
  ]);
  const salesToday = salesTodayRes.length > 0 ? salesTodayRes[0].total : 0;

  // ยอดขายรายวัน 14 วันล่าสุด (สำหรับกราฟแท่งในหน้าแดชบอร์ด)
  const fourteenDaysAgo = new Date(today);
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 13); // รวมวันนี้ด้วย = 14 วัน

  const dailySalesRaw = await Order.aggregate([
    { $match: { createdAt: { $gte: fourteenDaysAgo }, status: 'completed' } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        total: { $sum: '$price_paid' }
      }
    }
  ]);

  // เติมวันที่ไม่มียอดขายให้เป็น 0 เรียงตามลำดับวันที่ต่อเนื่องกัน
  const salesByDate = {};
  dailySalesRaw.forEach(d => { salesByDate[d._id] = d.total; });

  const dailySales = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(fourteenDaysAgo);
    d.setDate(d.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    dailySales.push({ date: key, total: salesByDate[key] || 0 });
  }

  res.render('admin/dashboard', { productCount, memberCount, pendingTopups, salesToday, dailySales });
});

// ---------- Products CRUD ----------
router.get('/products', async (req, res) => {
  const products = await Product.find().sort({ createdAt: -1 });
  res.render('admin/products', { products });
});

router.get('/products/new', (req, res) => {
  res.render('admin/product-form', { product: null, error: null });
});

router.post('/products/new', (req, res) => {
  upload.single('image')(req, res, async (uploadErr) => {
    if (uploadErr) {
      return res.render('admin/product-form', {
        product: null,
        error: uploadErr.message || 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }
    try {
      const { title, price, ...body } = req.body;
      const priceSatang = Math.round(parseFloat(price) * 100);
      if (!title || !title.trim()) {
        throw new Error('กรุณากรอกชื่อสินค้า');
      }
      if (!Number.isFinite(priceSatang) || priceSatang < 0) {
        throw new Error('กรุณากรอกราคาเป็นตัวเลขที่ถูกต้อง');
      }
      const imagePath = req.file ? req.file.path : null; // Cloudinary จะคืนเป็น URL แบบเต็มมาให้เลย
      const imagePublicId = req.file ? req.file.filename : null; // filename = public_id บน Cloudinary
      const product = await Product.create({
        ...body, title, price: priceSatang, image_path: imagePath, image_public_id: imagePublicId,
      });
      await logActivity(req.session.user.id, 'สร้างสินค้าใหม่', title);
      res.redirect(`/admin/products/${product._id}/stock`);
    } catch (err) {
      console.error('Create product error:', err);
      res.render('admin/product-form', {
        product: null,
        error: err.message || 'เพิ่มสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }
  });
});

router.get('/products/:id/edit', async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) {
    return res.status(404).render('error', { message: 'ไม่พบสินค้านี้' });
  }
  res.render('admin/product-form', { product, error: null });
});

router.post('/products/:id/edit', (req, res) => {
  upload.single('image')(req, res, async (uploadErr) => {
    const currentProduct = await Product.findById(req.params.id);
    if (uploadErr) {
      return res.render('admin/product-form', {
        product: currentProduct,
        error: uploadErr.message || 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }
    try {
      if (!currentProduct) {
        return res.status(404).render('error', { message: 'ไม่พบสินค้านี้' });
      }
      const priceSatang = Math.round(parseFloat(req.body.price) * 100);
      if (!Number.isFinite(priceSatang) || priceSatang < 0) {
        throw new Error('กรุณากรอกราคาเป็นตัวเลขที่ถูกต้อง');
      }
      if (req.file && currentProduct.image_public_id) {
        cloudinary.uploader.destroy(currentProduct.image_public_id).catch(() => {});
      }
      await Product.findByIdAndUpdate(req.params.id, {
        ...req.body, price: priceSatang,
        image_path: req.file ? req.file.path : currentProduct.image_path,
        image_public_id: req.file ? req.file.filename : currentProduct.image_public_id,
      });
      await logActivity(req.session.user.id, 'แก้ไขสินค้า', req.body.title);
      res.redirect('/admin/products');
    } catch (err) {
      console.error('Edit product error:', err);
      res.render('admin/product-form', {
        product: currentProduct,
        error: err.message || 'แก้ไขสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }
  });
});

router.post('/products/:id/delete', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.redirect('/admin/products');
    }
    // ลบเฉพาะไอดีที่ยังไม่ได้ขาย (available) ส่วนที่ขายไปแล้วเก็บไว้เพื่อประวัติคำสั่งซื้อ
    await StockItem.deleteMany({ product_id: product._id, status: 'available' });
    if (product.image_public_id) {
      cloudinary.uploader.destroy(product.image_public_id).catch(() => {});
    }
    await Product.findByIdAndDelete(req.params.id);
    await logActivity(req.session.user.id, 'ลบสินค้า', product.title);
    res.redirect('/admin/products');
  } catch (err) {
    console.error('Delete product error:', err);
    res.status(500).render('error', { message: 'ลบสินค้าไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

// ---------- Stock Management ----------
router.get('/products/:id/stock', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).render('error', { message: 'ไม่พบสินค้านี้' });
    }
    const items = await StockItem.find({ product_id: product._id })
      .sort({ createdAt: -1 })
      .populate('order_id');

    const availableCount = items.filter(i => i.status === 'available').length;
    const soldCount = items.filter(i => i.status !== 'available').length;

    res.render('admin/product-stock', {
      product,
      items,
      availableCount,
      soldCount,
      maxStock: MAX_STOCK_PER_PRODUCT,
      error: null,
    });
  } catch (err) {
    console.error('Load stock page error:', err);
    res.status(500).render('error', { message: 'โหลดหน้าจัดการสต็อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

router.post('/products/:id/stock/add', async (req, res) => {
  try {
    const product = await Product.findById(req.params.id);
    if (!product) {
      return res.status(404).render('error', { message: 'ไม่พบสินค้านี้' });
    }

    const lines = (req.body.items || '').split('\n').map(l => l.trim()).filter(l => l);
    const currentAvailable = await StockItem.countDocuments({ product_id: product._id, status: 'available' });

    if (lines.length === 0) {
      const items = await StockItem.find({ product_id: product._id }).sort({ createdAt: -1 }).populate('order_id');
      const soldCount = items.filter(i => i.status !== 'available').length;
      return res.status(400).render('admin/product-stock', {
        product, items, availableCount: currentAvailable, soldCount,
        maxStock: MAX_STOCK_PER_PRODUCT, error: 'กรุณาวางไอดีอย่างน้อย 1 รายการ',
      });
    }

    if (currentAvailable + lines.length > MAX_STOCK_PER_PRODUCT) {
      const items = await StockItem.find({ product_id: product._id }).sort({ createdAt: -1 }).populate('order_id');
      const soldCount = items.filter(i => i.status !== 'available').length;
      return res.status(400).render('admin/product-stock', {
        product, items, availableCount: currentAvailable, soldCount,
        maxStock: MAX_STOCK_PER_PRODUCT,
        error: `เพิ่มได้อีกไม่เกิน ${Math.max(0, MAX_STOCK_PER_PRODUCT - currentAvailable)} รายการ (เกินขีดจำกัดสต็อกสูงสุด)`,
      });
    }

    const docs = lines.map(line => ({ product_id: product._id, content: line }));
    await StockItem.insertMany(docs);

    // อัปเดตจำนวนสต็อก
    const count = await StockItem.countDocuments({ product_id: product._id, status: 'available' });
    await Product.findByIdAndUpdate(product._id, { stock: count });
    await logActivity(req.session.user.id, 'เติมสต็อก', `${product.title} (+${lines.length} รายการ)`);

    res.redirect(`/admin/products/${product._id}/stock`);
  } catch (err) {
    console.error('Add stock error:', err);
    res.status(500).render('error', { message: 'เติมสต็อกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

router.post('/products/:id/stock/:itemId/delete', async (req, res) => {
  try {
    const item = await StockItem.findOne({ _id: req.params.itemId, product_id: req.params.id });
    if (item && item.status === 'available') {
      await StockItem.findByIdAndDelete(item._id);
      const count = await StockItem.countDocuments({ product_id: req.params.id, status: 'available' });
      await Product.findByIdAndUpdate(req.params.id, { stock: count });
      await logActivity(req.session.user.id, 'ลบไอดีออกจากสต็อก', item.content);
    }
    res.redirect(`/admin/products/${req.params.id}/stock`);
  } catch (err) {
    console.error('Delete stock item error:', err);
    res.status(500).render('error', { message: 'ลบไอดีไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

// ---------- Members & Orders & Topups ----------
router.get('/members', async (req, res) => {
  const members = await User.find().sort({ createdAt: -1 });
  res.render('admin/members', { members });
});

router.get('/orders', async (req, res) => {
  const search = (req.query.search || '').trim();
  const filter = {};

  if (search) {
    // ให้ค้นหาได้ทั้งแบบมี # นำหน้าหรือไม่มีก็ได้ และไม่สนตัวพิมพ์เล็ก/ใหญ่
    const normalized = search.startsWith('#') ? search.slice(1) : search;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    filter.order_code = new RegExp(escaped, 'i');
  }

  const ordersRaw = await Order.find(filter)
    .populate('user_id', 'username')
    .populate('product_id', 'title')
    .sort({ createdAt: -1 });

  const orders = ordersRaw.map(o => ({
    id: o._id.toString(),
    order_code: o.order_code || '-',
    username: o.user_id ? o.user_id.username : '(ไม่พบผู้ใช้)',
    product_title: o.product_id ? o.product_id.title : '(ไม่พบสินค้า)',
    price_paid: o.price_paid,
    status: o.status,
    delivered_content: o.delivered_content,
    created_at: o.createdAt.toLocaleString('th-TH'),
  }));

  res.render('admin/orders', { orders, search });
});

router.get('/topups', async (req, res) => {
  const topupsRaw = await Topup.find()
    .populate('user_id', 'username')
    .sort({ createdAt: -1 });

  const topups = topupsRaw.map(t => ({
    id: t._id.toString(),
    username: t.user_id ? t.user_id.username : '(ไม่พบผู้ใช้)',
    amount: t.amount,
    reference: t.reference,
    status: t.status,
    created_at: t.createdAt.toLocaleString('th-TH'),
  }));

  res.render('admin/topups', { topups });
});

router.post('/topups/:id/approve', async (req, res) => {
  const topup = await Topup.findById(req.params.id);
  if (topup && topup.status === 'pending') {
    await Topup.findByIdAndUpdate(req.params.id, { status: 'approved' });
    await User.findByIdAndUpdate(topup.user_id, { $inc: { balance: topup.amount } });
    await logActivity(req.session.user.id, 'อนุมัติการเติมเงิน', topup._id.toString());
  }
  res.redirect('/admin/topups');
});

router.post('/topups/:id/reject', async (req, res) => {
  const topup = await Topup.findById(req.params.id);
  if (topup && topup.status === 'pending') {
    await Topup.findByIdAndUpdate(req.params.id, { status: 'rejected' });
    await logActivity(req.session.user.id, 'ปฏิเสธการเติมเงิน', topup._id.toString());
  }
  res.redirect('/admin/topups');
});

router.get('/logs', async (req, res) => {
  const logs = await AdminLog.find().populate('admin_id').sort({ createdAt: -1 }).limit(200);
  res.render('admin/logs', { logs });
});

// ---------- Category Banners (กล่อง FREEFIRE / ROV ฯลฯ หน้าแรก) ----------
// เข้าถึงได้เฉพาะแอดมินเท่านั้น (router.use(requireAdmin) ด้านบนครอบคลุมทุก route ในไฟล์นี้)
async function loadBannerRows() {
  const categories = await Product.distinct('category');
  const banners = await CategoryBanner.find();
  const bannerMap = {};
  banners.forEach(b => { bannerMap[b.category] = b; });

  // รวมหมวดหมู่จากสินค้าจริง + หมวดหมู่ที่เคยตั้งค่าแบนเนอร์ไว้ก่อนหน้า (เผื่อสินค้าถูกลบไปหมดแล้วแต่ยังอยากเก็บค่าไว้)
  const allNames = Array.from(new Set([...categories, ...banners.map(b => b.category)])).sort();
  return allNames.map(name => ({ category: name, banner: bannerMap[name] || null }));
}

router.get('/banners', async (req, res) => {
  const rows = await loadBannerRows();
  res.render('admin/banners', { rows, error: null });
});

router.post('/banners/:category/update', (req, res) => {
  uploadBanner.single('image')(req, res, async (uploadErr) => {
    const categoryName = req.params.category; // Express decode ค่า param ให้อัตโนมัติแล้ว
    if (uploadErr) {
      const rows = await loadBannerRows();
      return res.render('admin/banners', {
        rows,
        error: uploadErr.message || 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }
    try {
      const existing = await CategoryBanner.findOne({ category: categoryName });
      const title = (req.body.title || '').trim();
      const subtitle = (req.body.subtitle || '').trim();

      // ถ้าอัปโหลดรูปใหม่ ให้ลบรูปเดิมบน Cloudinary ทิ้งกันขยะสะสม
      if (req.file && existing && existing.image_public_id) {
        cloudinary.uploader.destroy(existing.image_public_id).catch(() => {});
      }

      const update = {
        title: title || null,
        subtitle: subtitle || null,
        updated_by: req.session.user.id,
        updatedAt: new Date(),
      };
      if (req.file) {
        update.image_path = req.file.path; // Cloudinary คืน URL แบบเต็มมาให้เลย (เก็บถาวร ไม่หายตอน deploy ใหม่)
        update.image_public_id = req.file.filename;
      }

      await CategoryBanner.findOneAndUpdate(
        { category: categoryName },
        { $set: update, $setOnInsert: { category: categoryName } },
        { upsert: true, new: true }
      );

      await logActivity(req.session.user.id, 'แก้ไขแบนเนอร์หมวดหมู่', categoryName);
      res.redirect('/admin/banners');
    } catch (err) {
      console.error('Update banner error:', err);
      res.status(500).render('error', { message: 'บันทึกแบนเนอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
  });
});

router.post('/banners/:category/reset', async (req, res) => {
  try {
    const categoryName = req.params.category;
    const existing = await CategoryBanner.findOne({ category: categoryName });
    if (existing) {
      if (existing.image_public_id) {
        cloudinary.uploader.destroy(existing.image_public_id).catch(() => {});
      }
      await CategoryBanner.findByIdAndDelete(existing._id);
      await logActivity(req.session.user.id, 'รีเซ็ตแบนเนอร์หมวดหมู่กลับเป็นค่าเริ่มต้น', categoryName);
    }
    res.redirect('/admin/banners');
  } catch (err) {
    console.error('Reset banner error:', err);
    res.status(500).render('error', { message: 'รีเซ็ตแบนเนอร์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

// ---------- Homepage Hero Text & Image (หัวข้อ + คำโปรย + รูปฝั่งขวาด้านบนสุดของหน้าแรก) ----------
router.get('/site-content', async (req, res) => {
  const siteContent = await SiteContent.findOne({ key: 'homepage' });
  const defaultSubtitle = `${req.app.locals.storeName} — เติมเงินง่าย ปลอดภัย ดูแลสมาชิกทุกระดับ`;
  res.render('admin/site-content', {
    heroHeading: siteContent && siteContent.hero_heading ? siteContent.hero_heading : DEFAULT_HERO_HEADING,
    heroSubtitle: siteContent && siteContent.hero_subtitle ? siteContent.hero_subtitle : defaultSubtitle,
    heroImagePath: siteContent ? siteContent.hero_image_path : null,
    hasCustomContent: !!siteContent,
    error: null,
  });
});

router.post('/site-content/update', (req, res) => {
  uploadHero.single('hero_image')(req, res, async (uploadErr) => {
    const existing = await SiteContent.findOne({ key: 'homepage' });

    if (uploadErr) {
      const defaultSubtitle = `${req.app.locals.storeName} — เติมเงินง่าย ปลอดภัย ดูแลสมาชิกทุกระดับ`;
      return res.status(400).render('admin/site-content', {
        heroHeading: existing && existing.hero_heading ? existing.hero_heading : DEFAULT_HERO_HEADING,
        heroSubtitle: existing && existing.hero_subtitle ? existing.hero_subtitle : defaultSubtitle,
        heroImagePath: existing ? existing.hero_image_path : null,
        hasCustomContent: !!existing,
        error: uploadErr.message || 'อัปโหลดรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
      });
    }

    try {
      const heroHeading = (req.body.hero_heading || '').trim();
      const heroSubtitle = (req.body.hero_subtitle || '').trim();

      if (!heroHeading || !heroSubtitle) {
        const defaultSubtitle = `${req.app.locals.storeName} — เติมเงินง่าย ปลอดภัย ดูแลสมาชิกทุกระดับ`;
        return res.status(400).render('admin/site-content', {
          heroHeading: heroHeading || DEFAULT_HERO_HEADING,
          heroSubtitle: heroSubtitle || defaultSubtitle,
          heroImagePath: existing ? existing.hero_image_path : null,
          hasCustomContent: true,
          error: 'กรุณากรอกทั้งข้อความหัวข้อและคำโปรย',
        });
      }

      // ถ้าอัปโหลดรูปใหม่ ให้ลบรูปเดิมบน Cloudinary ทิ้งกันขยะสะสม
      if (req.file && existing && existing.hero_image_public_id) {
        cloudinary.uploader.destroy(existing.hero_image_public_id).catch(() => {});
      }

      const update = {
        hero_heading: heroHeading,
        hero_subtitle: heroSubtitle,
        updated_by: req.session.user.id,
        updatedAt: new Date(),
      };
      if (req.file) {
        update.hero_image_path = req.file.path; // Cloudinary คืน URL แบบเต็มมาให้เลย (เก็บถาวร ไม่หายตอน deploy ใหม่) ขนาดไม่ถูกบังคับครอป ปรับตามรูปจริงที่อัปโหลด
        update.hero_image_public_id = req.file.filename;
      }

      await SiteContent.findOneAndUpdate(
        { key: 'homepage' },
        { $set: update, $setOnInsert: { key: 'homepage' } },
        { upsert: true, new: true }
      );

      await logActivity(req.session.user.id, 'แก้ไขข้อความ/รูปหน้าแรก', 'hero heading/subtitle/image');
      res.redirect('/admin/site-content');
    } catch (err) {
      console.error('Update site content error:', err);
      res.status(500).render('error', { message: 'บันทึกข้อความหน้าแรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
    }
  });
});

router.post('/site-content/image/remove', async (req, res) => {
  try {
    const existing = await SiteContent.findOne({ key: 'homepage' });
    if (existing && existing.hero_image_path) {
      if (existing.hero_image_public_id) {
        cloudinary.uploader.destroy(existing.hero_image_public_id).catch(() => {});
      }
      existing.hero_image_path = null;
      existing.hero_image_public_id = null;
      existing.updated_by = req.session.user.id;
      existing.updatedAt = new Date();
      await existing.save();
      await logActivity(req.session.user.id, 'ลบรูปหน้าแรก', 'hero image');
    }
    res.redirect('/admin/site-content');
  } catch (err) {
    console.error('Remove hero image error:', err);
    res.status(500).render('error', { message: 'ลบรูปหน้าแรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

router.post('/site-content/reset', async (req, res) => {
  try {
    const existing = await SiteContent.findOne({ key: 'homepage' });
    if (existing && existing.hero_image_public_id) {
      cloudinary.uploader.destroy(existing.hero_image_public_id).catch(() => {});
    }
    await SiteContent.deleteOne({ key: 'homepage' });
    await logActivity(req.session.user.id, 'รีเซ็ตข้อความ/รูปหน้าแรกกลับเป็นค่าเริ่มต้น', 'hero heading/subtitle/image');
    res.redirect('/admin/site-content');
  } catch (err) {
    console.error('Reset site content error:', err);
    res.status(500).render('error', { message: 'รีเซ็ตข้อความหน้าแรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
