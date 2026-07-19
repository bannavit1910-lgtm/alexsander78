const express = require('express');
const { requireLogin } = require('../middleware/auth');
const Product = require('../models/Product');
const User = require('../models/User');
const Order = require('../models/Order');
const StockItem = require('../models/StockItem');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const category = req.query.category;
    let products;
    
    // ค้นหาสินค้า
    if (category && category !== 'ทั้งหมด') {
      products = await Product.find({ category }).sort({ createdAt: -1 });
    } else {
      products = await Product.find().sort({ createdAt: -1 });
    }
    
    // ดึงหมวดหมู่ทั้งหมดแบบไม่ซ้ำ
    const categories = await Product.distinct('category');

    // นับจำนวนสินค้าต่อหมวดหมู่ (ไม่ขึ้นกับตัวกรองที่เลือกอยู่) ใช้ทำแบนเนอร์แนะนำหมวดหมู่ด้านบน
    const categoryCountsRaw = await Product.aggregate([
      { $group: { _id: '$category', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 4 },
    ]);
    const categoryCounts = categoryCountsRaw.map(c => ({ name: c._id || 'ทั่วไป', count: c.count }));

    res.render('index', { products, categories, categoryCounts, activeCategory: category || 'ทั้งหมด' });
  } catch (error) {
    console.error('Error loading products:', error);
    res.status(500).send('Server Error');
  }
});

// ซื้อสินค้า: หักยอดคงเหลือของผู้ใช้ แล้วสร้างรายการคำสั่งซื้อ (รองรับการซื้อหลายจำนวน)
router.post('/buy/:id', requireLogin, async (req, res) => {
  try {
    const productId = req.params.id;

    // จำนวนที่ต้องการซื้อ (อย่างน้อย 1 ชิ้น)
    let quantity = parseInt(req.body.quantity, 10);
    if (!Number.isInteger(quantity) || quantity < 1) {
      quantity = 1;
    }
    const MAX_QTY_PER_ORDER = 20;
    if (quantity > MAX_QTY_PER_ORDER) {
      quantity = MAX_QTY_PER_ORDER;
    }

    // ดึงข้อมูลสินค้า
    const product = await Product.findById(productId);
    if (!product) {
      return res.status(404).render('error', { message: 'ไม่พบสินค้านี้' });
    }
    if (product.stock <= 0) {
      return res.status(400).render('error', { message: 'สินค้าหมดสต็อกแล้ว' });
    }

    // ดึงข้อมูลผู้ใช้
    const user = await User.findById(req.session.user.id);
    const unitPrice = Math.round(product.price * (1 - product.discount_percent / 100));
    const totalPrice = unitPrice * quantity;

    if (user.balance < totalPrice) {
      return res.status(400).render('error', {
        message: `ยอดเงินคงเหลือไม่พอ (คงเหลือ ฿${(user.balance / 100).toFixed(2)}, ยอดที่ต้องชำระ ฿${(totalPrice / 100).toFixed(2)}) กรุณาเติมเงินก่อนทำรายการ`,
      });
    }

    // ดึงไอดี/สต็อกที่ยังว่างอยู่ตามจำนวนที่ต้องการ (เก่าสุดก่อน)
    const items = await StockItem.find({ product_id: product._id, status: 'available' })
      .sort({ createdAt: 1 })
      .limit(quantity);

    if (items.length < quantity) {
      return res.status(400).render('error', {
        message: `สต็อกไม่พอสำหรับจำนวนที่ต้องการ (เหลือ ${items.length} รายการ) กรุณาลดจำนวนหรือรอเติมสต็อก`,
      });
    }

    // หักเงินผู้ใช้
    user.balance -= totalPrice;
    await user.save();

    // สร้าง Order และอัปเดตสถานะ StockItem ทีละรายการ
    for (const item of items) {
      const newOrder = await Order.create({
        user_id: user._id,
        product_id: product._id,
        price_paid: unitPrice,
        status: 'completed',
        delivered_content: item.content
      });

      item.status = 'sold';
      item.order_id = newOrder._id;
      await item.save();
    }

    // อัปเดตจำนวนสต็อกรวมของสินค้า
    const availableStock = await StockItem.countDocuments({ product_id: product._id, status: 'available' });
    product.stock = availableStock;
    await product.save();

    res.redirect('/dashboard?bought=1');
    
  } catch (error) {
    console.error('Buy error:', error);
    res.status(500).render('error', { message: 'เกิดข้อผิดพลาดทางเซิร์ฟเวอร์ กรุณาลองใหม่อีกครั้ง' });
  }
});

module.exports = router;
