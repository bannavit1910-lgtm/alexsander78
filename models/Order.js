const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
  user_id: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: true },
  order_code: { type: String, required: true, unique: true, index: true }, // รหัสคำสั่งซื้อ เช่น #fviohs32472fd — ใช้ให้แอดมินค้นหา
  price_paid: { type: Number, required: true },
  status: { type: String, default: 'completed' }, // completed | pending | cancelled
  delivered_content: { type: String },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Order', orderSchema);
